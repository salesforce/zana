import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync, watch as fsWatch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalExtensionWatcher } from '../local-extension-watcher.js';

/**
 * End-to-end exercise of the full "author an extension" hot-reload path with
 * NO mocks: scaffold a dummy local extension on real disk, install it once,
 * arm the REAL LocalExtensionWatcher (real fs.watch, not the injected fake used
 * in local-extension-watcher.test.ts), edit its dist/renderer.js, and observe
 * the watcher notice the change and re-install automatically — the same
 * observable outcome a developer would see in the app (the panel picking up a
 * rebuilt renderer.js with no manual "Reload from source" click).
 *
 * This also guards the watched-path choice: the watcher watches
 * `workingDir/dist`, not `workingDir` itself, specifically so the changed file
 * is a DIRECT child of the watched path — required because `fs.watch`'s
 * `recursive: true` is unsupported on Linux (this repo's CI) and silently
 * falls back to non-recursive, which only reports direct children.
 */

let extDir: string; // stands in for ~/.zcc/extensions (ZCC_EXTENSIONS_DIR)
let workRoot: string; // stands in for ~/zcc-workspace (scratch workspace root)

async function importModules() {
  const discovery = await import('../extensions/discovery.js');
  const localExtension = await import('../local-extension.js');
  const installer = await import('../extension-installer.js');
  return { discovery, localExtension, installer };
}

/** Mirrors index.ts's packAndInstallLocal verbatim (sans runDiskSync, which needs the live app store). */
async function packAndInstallLocal(id: string, workingDir: string) {
  const { installer, localExtension } = await importModules();
  const packed = await localExtension.packLocalExtension(workingDir);
  if (!packed.ok) return packed;
  try {
    return await installer.installFromDir(packed.value.stagingDir, {
      reservedIds: new Set<string>(['slack']),
      log: () => {}
    });
  } finally {
    await rm(packed.value.stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function waitFor(predicate: () => boolean | Promise<boolean>, what: string, timeoutMs = 4000) {
  const start = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function triggerUntilInstalled(
  rendererPath: string,
  installedRenderer: string,
  original: string,
  marker: string
): Promise<void> {
  const start = Date.now();
  let attempt = 0;
  for (;;) {
    const currentMarker = `// ${marker}-${attempt}\n`;
    await writeFile(rendererPath, `${currentMarker}${original}`, 'utf-8');
    await new Promise((resolve) => setTimeout(resolve, 80));
    try {
      if (existsSync(installedRenderer) && (await readFile(installedRenderer, 'utf-8')).includes(currentMarker)) return;
    } catch (err: unknown) {
      // replaceDir removes the old install before renaming its replacement.
      // A concurrent read can cross that short window after existsSync passes.
      if (!(err instanceof Error) || !('code' in err) || err.code !== 'ENOENT') throw err;
    }
    if (Date.now() - start > 10_000) throw new Error(`timed out waiting for: auto-reinstalled renderer.js to contain ${marker}`);
    attempt += 1;
  }
}

describe('local-extension hot-reload (real fs, real fs.watch, dummy extension)', () => {
  beforeEach(async () => {
    extDir = await mkdtemp(join(tmpdir(), 'cc-ext-install-root-'));
    workRoot = await mkdtemp(join(tmpdir(), 'cc-ext-workdir-'));
    process.env.ZCC_EXTENSIONS_DIR = extDir;
  });
  afterEach(async () => {
    delete process.env.ZCC_EXTENSIONS_DIR;
    await rm(extDir, { recursive: true, force: true });
    await rm(workRoot, { recursive: true, force: true });
  });

  it(
    'auto-reinstalls a dummy extension when its dist/renderer.js is edited while a session sits in its working dir',
    async () => {
      const { discovery, localExtension } = await importModules();
      const id = 'hot-reload-dummy-c3d4';
      const workingDir = localExtension.workingDirFor(workRoot, id);

      const scaffolded = await localExtension.scaffoldLocalExtension(workingDir, {
        id,
        name: 'Hot Reload Dummy',
        description: 'a dummy extension for automated hot-reload verification',
        kind: 'panel'
      });
      expect(scaffolded.ok).toBe(true);
      await discovery.markLocal(id, workingDir);

      // First install — this is what createLocalExtension does right after
      // scaffolding, before the watcher is ever armed.
      const first = await packAndInstallLocal(id, workingDir);
      expect(first.ok).toBe(true);
      const installedRenderer = join(extDir, id, 'dist', 'renderer.js');
      expect(existsSync(installedRenderer)).toBe(true);
      expect(await readFile(installedRenderer, 'utf-8')).not.toContain('// hot-reload marker');

      const onFailure = vi.fn();
      const watcher = new LocalExtensionWatcher({
        isEnabled: () => true,
        findLocalRecordByCwd: discovery.findLocalRecordByCwd,
        readWorkingDirId: localExtension.readWorkingDirId,
        reinstall: (extId, dir) => packAndInstallLocal(extId, dir),
        onFailure,
        debounceMs: 50 // fast debounce so the test doesn't wait on the app's default 400ms unnecessarily
      });

      try {
        // A terminal session's cwd lands inside the extension's working dir —
        // this is what wireBridgeListeners' sessionUpdated hook does on a real
        // pty session.
        await watcher.onSessionMaybeLocal('sess-dummy-1', workingDir);

        // The "developer" edits the built renderer — the observable trigger a
        // real edit-and-rebuild loop would produce.
        const rendererPath = join(workingDir, 'dist', 'renderer.js');
        const original = await readFile(rendererPath, 'utf-8');
        // No manual "Reload from source" / install_local_extension call here —
        // the watcher must notice and re-install on its own. fs.watch has no
        // readiness barrier, so retry source writes until its OS subscription
        // observes one instead of treating a lost first event as product failure.
        await triggerUntilInstalled(rendererPath, installedRenderer, original, 'hot-reload marker');
        // Drain duplicate fs.watch notifications from the successful write before
        // testing post-close behavior; otherwise an already-queued reinstall can
        // observe the next source contents without any post-close watch event.
        await new Promise((resolve) => setTimeout(resolve, 150));

        expect(onFailure).not.toHaveBeenCalled();

        // Closing the last session in this working dir must release the
        // watcher — a later edit must NOT trigger another reinstall.
        watcher.onSessionExit('sess-dummy-1');
        await writeFile(rendererPath, `// second marker\n${original}`, 'utf-8');
        await new Promise((r) => setTimeout(r, 200)); // give a stray watch event time to (not) fire
        const afterClose = await readFile(installedRenderer, 'utf-8');
        expect(afterClose).not.toContain('// second marker');
      } finally {
        watcher.shutdown();
      }
    },
    15000
  );

  it(
    'still auto-reinstalls under a forced NON-RECURSIVE watch (simulates the Linux fs.watch fallback)',
    async () => {
      const { discovery, localExtension } = await importModules();
      const id = 'hot-reload-flatwatch-e5f6';
      const workingDir = localExtension.workingDirFor(workRoot, id);

      await localExtension.scaffoldLocalExtension(workingDir, {
        id,
        name: 'Flat Watch Dummy',
        kind: 'panel'
      });
      await discovery.markLocal(id, workingDir);
      const first = await packAndInstallLocal(id, workingDir);
      expect(first.ok).toBe(true);
      const installedRenderer = join(extDir, id, 'dist', 'renderer.js');

      const onFailure = vi.fn();
      const watcher = new LocalExtensionWatcher({
        isEnabled: () => true,
        findLocalRecordByCwd: discovery.findLocalRecordByCwd,
        readWorkingDirId: localExtension.readWorkingDirId,
        reinstall: (extId, dir) => packAndInstallLocal(extId, dir),
        onFailure,
        debounceMs: 50,
        // Force the non-recursive branch of node's real fs.watch — this is
        // exactly what defaultWatch's fallback does on Linux, where
        // { recursive: true } throws. If the watcher pointed at `workingDir`
        // instead of `workingDir/dist`, this test would time out: a flat
        // watch on Linux only reports DIRECT children of the watched path.
        watch: (path, cb) => fsWatch(path, { persistent: false }, cb)
      });

      try {
        await watcher.onSessionMaybeLocal('sess-flat-1', workingDir);

        const rendererPath = join(workingDir, 'dist', 'renderer.js');
        const original = await readFile(rendererPath, 'utf-8');
        await triggerUntilInstalled(rendererPath, installedRenderer, original, 'flat-watch marker');

        expect(onFailure).not.toHaveBeenCalled();
      } finally {
        watcher.shutdown();
      }
    },
    15000
  );
});
