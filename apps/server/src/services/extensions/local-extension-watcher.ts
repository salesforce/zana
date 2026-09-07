/**
 * Local-extension hot-reload watcher — the automatic trigger half of "author
 * an extension". Reinstalling a local extension from source already works
 * (the "Reload from source" button, and the `install_local_extension` MCP
 * tool both drive the same `packAndInstallLocal` tail) — nothing previously
 * WATCHED an extension's source `dist/`, so every rebuild needed an explicit
 * click or tool call.
 *
 * Deliberately scoped to stay inside Rule 5 (bounded background work): this
 * does NOT watch every scaffolded local extension forever. It watches a
 * given extension's `dist/` ONLY while at least one live terminal session's
 * cwd sits inside that extension's working dir — armed on
 * {@link LocalExtensionWatcher.onSessionMaybeLocal}, released on
 * {@link LocalExtensionWatcher.onSessionExit} once the last such session is
 * gone. Two sessions cwd'd into the same extension share one watcher via a
 * refcount, so closing one tab doesn't kill hot-reload for the other.
 *
 * All collaborators are injected (mirrors {@link HeartbeatDeps}) so the
 * arm/debounce/reinstall logic is unit-testable without Electron or a real
 * fs watcher.
 */

import { existsSync, watch as fsWatchDefault, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { Result } from '@zana-ai/zcc-domain/product';

type TimerHandle = NodeJS.Timeout;

export interface LocalExtensionWatcherDeps {
  /** Master switch. Read live so a config toggle takes effect immediately. */
  isEnabled: () => boolean;
  /** Reverse lookup: is `cwd` inside a registered local extension's working dir? */
  findLocalRecordByCwd: (
    cwd: string
  ) => Promise<{ id: string; record: { workingDir: string } } | null>;
  /** Sanity check mirroring reinstallLocal's ID_MISMATCH gate. */
  readWorkingDirId: (workingDir: string) => Promise<string | null>;
  /** Pack + install + reconcile (packAndInstallLocal). */
  reinstall: (id: string, workingDir: string) => Promise<Result<{ id: string }>>;
  /** Best-effort failure notice (logs + an inbox breadcrumb). Never throws. */
  onFailure: (id: string, workingDir: string, message: string) => void;
  /** Defaults to node:fs `watch`; injectable so tests don't touch the real fs. */
  watch?: (path: string, cb: () => void) => FSWatcher | null;
  /** Debounce window, ms. Defaults to 400 (matches syncExtensionsDebounced). */
  debounceMs?: number;
  /** Arm a timer; returns a handle. Injected so tests can use fake timers. */
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  /** Clear a timer handle. Injected to pair with {@link setTimer}. */
  clearTimer?: (handle: TimerHandle) => void;
}

function defaultWatch(path: string, cb: () => void): FSWatcher | null {
  try {
    return fsWatchDefault(path, { persistent: false, recursive: true }, cb);
  } catch {
    try {
      return fsWatchDefault(path, { persistent: false }, cb);
    } catch {
      return null; // unsupported fs — the extension just won't hot-reload
    }
  }
}

function defaultSetTimer(fn: () => void, ms: number): TimerHandle {
  return setTimeout(fn, ms);
}

function defaultClearTimer(handle: TimerHandle): void {
  clearTimeout(handle);
}

interface Entry {
  id: string;
  workingDir: string;
  watcher: FSWatcher | null;
  debounce: TimerHandle | null;
  recovery: TimerHandle | null;
  /** Sessions currently cwd'd into this working dir. */
  sessionIds: Set<string>;
  /** A reinstall is currently running — serialize so two never race the install dir (Rule 4). */
  reinstalling: boolean;
  /** A change arrived while a reinstall was in flight — run exactly one more when it finishes. */
  pendingReinstall: boolean;
}

export class LocalExtensionWatcher {
  /** Keyed by workingDir. */
  private entries = new Map<string, Entry>();
  /** sessionId -> workingDir, so onSessionExit can find the entry to decrement. */
  private sessionToWorkingDir = new Map<string, string>();

  constructor(private readonly deps: LocalExtensionWatcherDeps) {}

  /**
   * A session's cwd changed (or it was just created). If `cwd` sits inside a
   * registered local extension's working dir, arm (or join the refcount of)
   * that extension's watcher. No-op if the feature is off, the session was
   * already counted against a DIFFERENT working dir (moved — release the old
   * one first), or `cwd` isn't a known local extension.
   */
  async onSessionMaybeLocal(sessionId: string, cwd: string | undefined): Promise<void> {
    if (!cwd) return;
    const prevWorkingDir = this.sessionToWorkingDir.get(sessionId);
    if (!this.deps.isEnabled()) {
      if (prevWorkingDir) this.release(sessionId, prevWorkingDir);
      return;
    }
    const found = await this.deps.findLocalRecordByCwd(cwd);
    if (!found) {
      if (prevWorkingDir) this.release(sessionId, prevWorkingDir);
      return;
    }
    const { id, record } = found;
    if (prevWorkingDir === record.workingDir) return; // already armed for this session
    if (prevWorkingDir) this.release(sessionId, prevWorkingDir);
    this.acquire(sessionId, id, record.workingDir);
  }

  /** A session exited — release its slot (closes the watcher at refcount 0). */
  onSessionExit(sessionId: string): void {
    const workingDir = this.sessionToWorkingDir.get(sessionId);
    if (workingDir) this.release(sessionId, workingDir);
  }

  /** Release every watcher + timer (Rule 3 — call once on app shutdown). */
  shutdown(): void {
    for (const entry of this.entries.values()) {
      this.closeEntry(entry);
    }
    this.entries.clear();
    this.sessionToWorkingDir.clear();
  }

  // ----- internals -----------------------------------------------------------

  private acquire(sessionId: string, id: string, workingDir: string): void {
    this.sessionToWorkingDir.set(sessionId, workingDir);
    let entry = this.entries.get(workingDir);
    if (entry) {
      entry.sessionIds.add(sessionId);
      return;
    }
    entry = {
      id,
      workingDir,
      watcher: null,
      debounce: null,
      recovery: null,
      sessionIds: new Set([sessionId]),
      reinstalling: false,
      pendingReinstall: false
    };
    this.entries.set(workingDir, entry);
    this.attachWatch(entry);
  }

  private attachWatch(entry: Entry): void {
    if (!this.entries.has(entry.workingDir) || entry.watcher) return;
    const distDir = join(entry.workingDir, 'dist');
    const watchFn = this.deps.watch ?? defaultWatch;
    // Watch `dist/` itself (not `workingDir`) so a changed file is a DIRECT
    // child of the watched path — on Linux, fs.watch's recursive option is
    // unsupported and silently falls back to non-recursive (see defaultWatch),
    // which only reports direct children. Watching workingDir would miss
    // `workingDir/dist/renderer.js` edits on Linux CI.
    try {
      const watcher = watchFn(distDir, () => this.onChange(entry));
      entry.watcher = watcher;
      if (!watcher) {
        this.scheduleRecovery(entry);
        return;
      }
      // Test doubles only need change/close; real FSWatchers expose error events.
      if (typeof watcher.on === 'function') watcher.on('error', () => this.recoverWatch(entry, watcher));
    } catch {
      this.scheduleRecovery(entry);
    }
  }

  private recoverWatch(entry: Entry, watcher: FSWatcher): void {
    if (entry.watcher !== watcher) return;
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
    entry.watcher = null;
    this.scheduleRecovery(entry);
  }

  private scheduleRecovery(entry: Entry): void {
    if (!this.entries.has(entry.workingDir) || entry.recovery) return;
    const setTimer = this.deps.setTimer ?? defaultSetTimer;
    entry.recovery = setTimer(() => {
      entry.recovery = null;
      if (!existsSync(join(entry.workingDir, 'dist'))) {
        this.scheduleRecovery(entry);
        return;
      }
      this.attachWatch(entry);
    }, this.deps.debounceMs ?? 400);
  }

  private release(sessionId: string, workingDir: string): void {
    this.sessionToWorkingDir.delete(sessionId);
    const entry = this.entries.get(workingDir);
    if (!entry) return;
    entry.sessionIds.delete(sessionId);
    if (entry.sessionIds.size === 0) {
      this.closeEntry(entry);
      this.entries.delete(workingDir);
    }
  }

  private closeEntry(entry: Entry): void {
    if (entry.watcher) {
      try {
        entry.watcher.close();
      } catch {
        /* ignore */
      }
      entry.watcher = null;
    }
    const clearTimer = this.deps.clearTimer ?? defaultClearTimer;
    if (entry.debounce) {
      clearTimer(entry.debounce);
      entry.debounce = null;
    }
    if (entry.recovery) {
      clearTimer(entry.recovery);
      entry.recovery = null;
    }
  }

  private onChange(entry: Entry): void {
    // fs.watch may deliver a queued callback after close; never revive a
    // released entry or install from a working directory with no live session.
    if (this.entries.get(entry.workingDir) !== entry || entry.sessionIds.size === 0) return;
    const clearTimer = this.deps.clearTimer ?? defaultClearTimer;
    const setTimer = this.deps.setTimer ?? defaultSetTimer;
    if (entry.debounce) clearTimer(entry.debounce);
    entry.debounce = setTimer(() => {
      entry.debounce = null;
      void this.reinstall(entry);
    }, this.deps.debounceMs ?? 400);
  }

  private async reinstall(entry: Entry): Promise<void> {
    // Serialize: a reinstall does rm(installDir, recursive) + copy, so two
    // running at once race the install dir (recursive-rm vs the other's writes
    // → ENOTEMPTY). If one is already in flight, mark a single follow-up and
    // let the current run trigger it on completion (Rule 4).
    if (entry.reinstalling) {
      entry.pendingReinstall = true;
      return;
    }
    entry.reinstalling = true;
    try {
      // Re-check ownership at fire time — the source manifest could have been
      // hand-edited to a different id since we armed (mirrors reinstallLocal's
      // ID_MISMATCH gate), and this entry could already be closing.
      if (this.entries.get(entry.workingDir) !== entry || entry.sessionIds.size === 0) return;
      const declaredId = await this.deps.readWorkingDirId(entry.workingDir);
      // The last session can close while the manifest read is in flight.
      if (this.entries.get(entry.workingDir) !== entry || entry.sessionIds.size === 0) return;
      if (declaredId !== entry.id) {
        this.deps.onFailure(
          entry.id,
          entry.workingDir,
          `Source manifest id "${declaredId ?? '(none)'}" does not match "${entry.id}" — skipped hot-reload`
        );
        return;
      }
      const result = await this.deps.reinstall(entry.id, entry.workingDir);
      if (!result.ok) {
        this.deps.onFailure(entry.id, entry.workingDir, result.message);
      }
    } finally {
      entry.reinstalling = false;
      if (entry.pendingReinstall && this.entries.has(entry.workingDir)) {
        entry.pendingReinstall = false;
        void this.reinstall(entry);
      } else {
        entry.pendingReinstall = false;
      }
    }
  }
}
