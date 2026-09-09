import { existsSync, watch, type FSWatcher } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import type { CliPlanFile, TerminalSession } from '@zana-ai/zcc-domain/product';
import { harnessFamilyOf } from '@zana-ai/zcc-domain/launch-provider';
import {
  cliPlanDirsFor,
  discoverCliPlanForSession,
  isCliPlanFamily,
  isLocalCliPlanSession
} from './cli-plan-files.js';

const DEBOUNCE_MS = 150;
const MISSING_DIR_POLL_MS = 2_000;

export type CliPlanWatchDeps = {
  getSession: (sessionId: string) => TerminalSession | null;
  allowedRootsFor: (session: TerminalSession) => string[];
  homedir?: () => string;
  emit: (sessionId: string, snapshot: CliPlanFile | null) => void;
};

type SessionWatch = {
  refs: number;
  watchers: FSWatcher[];
  missingTimer: ReturnType<typeof setInterval> | null;
  debounce: ReturnType<typeof setTimeout> | null;
};

/**
 * Refcounted per-session plan-dir watches. Subscribe only while the inspector
 * Plan pin is mounted; drop on unwatch and on pty exit (Rule 3).
 */
export class CliPlanWatcher {
  private readonly sessions = new Map<string, SessionWatch>();

  constructor(private readonly deps: CliPlanWatchDeps) {}

  snapshot(sessionId: string): CliPlanFile | null {
    const session = this.deps.getSession(sessionId);
    if (!session) return null;
    return discoverCliPlanForSession(session, {
      homedir: this.deps.homedir?.() ?? osHomedir(),
      allowedRoots: this.deps.allowedRootsFor(session)
    });
  }

  watch(sessionId: string): void {
    const session = this.deps.getSession(sessionId);
    if (!session || !session.cliPlanIntent || !isLocalCliPlanSession(session)) return;
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.refs += 1;
      this.flush(sessionId);
      return;
    }
    this.sessions.set(sessionId, {
      refs: 1,
      watchers: [],
      missingTimer: null,
      debounce: null
    });
    this.arm(sessionId);
    this.flush(sessionId);
  }

  unwatch(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    existing.refs -= 1;
    if (existing.refs > 0) return;
    this.drop(sessionId);
  }

  onSessionExit(sessionId: string): void {
    this.drop(sessionId);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.drop(id);
  }

  private drop(sessionId: string): void {
    const existing = this.sessions.get(sessionId);
    if (!existing) return;
    this.sessions.delete(sessionId);
    for (const watcher of existing.watchers) {
      try { watcher.close(); } catch { /* already closed */ }
    }
    if (existing.missingTimer) clearInterval(existing.missingTimer);
    if (existing.debounce) clearTimeout(existing.debounce);
  }

  private arm(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    const session = this.deps.getSession(sessionId);
    if (!record || !session) return;
    for (const watcher of record.watchers) {
      try { watcher.close(); } catch { /* already closed */ }
    }
    record.watchers = [];
    if (record.missingTimer) {
      clearInterval(record.missingTimer);
      record.missingTimer = null;
    }
    const family = harnessFamilyOf(session.profile);
    if (!isCliPlanFamily(family)) return;
    const dirs = cliPlanDirsFor({
      family,
      cwd: session.cwd,
      homedir: this.deps.homedir?.() ?? osHomedir(),
      allowedRoots: this.deps.allowedRootsFor(session)
    });
    let missing = false;
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        missing = true;
        continue;
      }
      try {
        const watcher = watch(dir, { persistent: false }, () => this.scheduleFlush(sessionId));
        watcher.on('error', () => this.scheduleFlush(sessionId));
        record.watchers.push(watcher);
      } catch {
        missing = true;
      }
    }
    if (missing) {
      record.missingTimer = setInterval(() => {
        const live = this.sessions.get(sessionId);
        if (!live) return;
        for (const watcher of live.watchers) {
          try { watcher.close(); } catch { /* already closed */ }
        }
        live.watchers = [];
        if (live.missingTimer) {
          clearInterval(live.missingTimer);
          live.missingTimer = null;
        }
        this.arm(sessionId);
        this.flush(sessionId);
      }, MISSING_DIR_POLL_MS);
      (record.missingTimer as NodeJS.Timeout).unref?.();
    }
  }

  private scheduleFlush(sessionId: string): void {
    const record = this.sessions.get(sessionId);
    if (!record) return;
    if (record.debounce) clearTimeout(record.debounce);
    record.debounce = setTimeout(() => {
      record.debounce = null;
      this.flush(sessionId);
    }, DEBOUNCE_MS);
  }

  private flush(sessionId: string): void {
    this.deps.emit(sessionId, this.snapshot(sessionId));
  }
}
