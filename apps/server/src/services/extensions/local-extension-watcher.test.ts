import { describe, it, expect, vi } from 'vitest';
import type { FSWatcher } from 'node:fs';
import { LocalExtensionWatcher, type LocalExtensionWatcherDeps } from './local-extension-watcher.js';

/** Deterministic fake clock, mirroring heartbeat.test.ts's makeClock(). */
function makeClock() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const setTimer = vi.fn((fn: () => void) => {
    const id = nextId++;
    pending.set(id, fn);
    return id as unknown as NodeJS.Timeout;
  });
  const clearTimer = vi.fn((handle: NodeJS.Timeout) => {
    pending.delete(handle as unknown as number);
  });
  return {
    setTimer,
    clearTimer,
    fireAll() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    pendingCount: () => pending.size
  };
}

/** A fake fs watcher whose close() is observable and whose change callback is exposed. */
function makeFakeWatch() {
  const watchers = new Map<string, { close: () => void; fire: () => void }>();
  const closed = new Set<string>();
  const watch = vi.fn((path: string, cb: () => void) => {
    const handle = {
      close: () => closed.add(path),
      fire: cb
    };
    watchers.set(path, handle);
    return { close: handle.close } as unknown as FSWatcher;
  });
  return { watch, watchers, closed };
}

function makeDeps(over: Partial<LocalExtensionWatcherDeps> = {}) {
  const clock = makeClock();
  const { watch, watchers, closed } = makeFakeWatch();
  const reinstall = vi.fn(async () => ({ ok: true as const, value: { id: 'my-ext-a1b2' } }));
  const onFailure = vi.fn();
  const findLocalRecordByCwd = vi.fn(async (cwd: string) => {
    if (cwd.startsWith('/work/my-ext')) {
      return { id: 'my-ext-a1b2', record: { workingDir: '/work/my-ext' } };
    }
    return null;
  });
  const readWorkingDirId = vi.fn(async () => 'my-ext-a1b2');
  const deps: LocalExtensionWatcherDeps = {
    isEnabled: () => true,
    findLocalRecordByCwd,
    readWorkingDirId,
    reinstall,
    onFailure,
    watch,
    debounceMs: 400,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over
  };
  return { deps, clock, watch, watchers, closed, reinstall, onFailure, findLocalRecordByCwd, readWorkingDirId };
}

describe('LocalExtensionWatcher', () => {
  it('arms a watcher on the extension\'s dist/ dir when a session cwd is inside its working dir', async () => {
    const { deps, watch } = makeDeps();
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');
    expect(watch).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledWith('/work/my-ext/dist', expect.any(Function));
  });

  it('does nothing for a cwd that is not a known local extension', async () => {
    const { deps, watch } = makeDeps();
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/some/random/dir');
    expect(watch).not.toHaveBeenCalled();
  });

  it('debounces a burst of changes into one reinstall', async () => {
    const { deps, watchers, clock, reinstall } = makeDeps();
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');

    const handle = watchers.get('/work/my-ext/dist')!;
    handle.fire();
    handle.fire();
    handle.fire();
    expect(clock.pendingCount()).toBe(1); // each fire re-debounced onto ONE timer

    clock.fireAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(reinstall).toHaveBeenCalledTimes(1);
    expect(reinstall).toHaveBeenCalledWith('my-ext-a1b2', '/work/my-ext');
  });

  it('shares one watcher between two sessions cwd-ed into the same extension (refcount)', async () => {
    const { deps, watch, closed } = makeDeps();
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');
    await w.onSessionMaybeLocal('sess-2', '/work/my-ext');
    expect(watch).toHaveBeenCalledTimes(1); // second session joins the existing watcher

    w.onSessionExit('sess-1');
    expect(closed.has('/work/my-ext/dist')).toBe(false); // sess-2 still holds it open

    w.onSessionExit('sess-2');
    expect(closed.has('/work/my-ext/dist')).toBe(true); // last session gone — watcher closes
  });

  it('closes the watcher on the last session exit and does not reinstall on a later change', async () => {
    const { deps, watchers, clock, reinstall } = makeDeps();
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');
    const handle = watchers.get('/work/my-ext/dist')!;

    w.onSessionExit('sess-1');
    handle.fire(); // a stray event on an already-closed watcher's callback
    clock.fireAll();
    await Promise.resolve();

    expect(reinstall).not.toHaveBeenCalled();
  });

  it('is a no-op when disabled', async () => {
    const { deps, watch } = makeDeps({ isEnabled: () => false });
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');
    expect(watch).not.toHaveBeenCalled();
  });

  it('reports a failure via onFailure without throwing when reinstall fails', async () => {
    const { deps, watchers, clock, onFailure } = makeDeps({
      reinstall: vi.fn(async () => ({ ok: false as const, code: 'BAD', message: 'boom' }))
    });
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');
    watchers.get('/work/my-ext/dist')!.fire();
    clock.fireAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(onFailure).toHaveBeenCalledWith('my-ext-a1b2', '/work/my-ext', 'boom');
  });

  it('skips reinstall and reports ID_MISMATCH when the source manifest id changed', async () => {
    const { deps, watchers, clock, reinstall, onFailure } = makeDeps({
      readWorkingDirId: vi.fn(async () => 'a-different-id')
    });
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');
    watchers.get('/work/my-ext/dist')!.fire();
    clock.fireAll();
    await Promise.resolve();
    await Promise.resolve();

    expect(reinstall).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      'my-ext-a1b2',
      '/work/my-ext',
      expect.stringContaining('does not match')
    );
  });

  it('moves a session between working dirs when its cwd changes', async () => {
    const { deps, watch, closed } = makeDeps({
      findLocalRecordByCwd: vi.fn(async (cwd: string) => {
        if (cwd === '/work/ext-a') return { id: 'ext-a', record: { workingDir: '/work/ext-a' } };
        if (cwd === '/work/ext-b') return { id: 'ext-b', record: { workingDir: '/work/ext-b' } };
        return null;
      })
    });
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/ext-a');
    await w.onSessionMaybeLocal('sess-1', '/work/ext-b');

    expect(watch).toHaveBeenCalledWith('/work/ext-a/dist', expect.any(Function));
    expect(watch).toHaveBeenCalledWith('/work/ext-b/dist', expect.any(Function));
    expect(closed.has('/work/ext-a/dist')).toBe(true); // released the old one
    expect(closed.has('/work/ext-b/dist')).toBe(false);
  });

  it('shutdown closes every watcher and clears pending timers', async () => {
    const { deps, watchers, closed, clock } = makeDeps();
    const w = new LocalExtensionWatcher(deps);
    await w.onSessionMaybeLocal('sess-1', '/work/my-ext');
    watchers.get('/work/my-ext/dist')!.fire(); // arm a debounce timer
    expect(clock.pendingCount()).toBe(1);

    w.shutdown();

    expect(closed.has('/work/my-ext/dist')).toBe(true);
    expect(clock.pendingCount()).toBe(0);
  });
});
