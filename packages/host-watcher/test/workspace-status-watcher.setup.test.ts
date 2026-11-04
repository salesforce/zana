import fs from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceStatusWatcher } from '../src/workspace-status-watcher.js';

const fixture = vi.hoisted(() => ({
  ignores: vi.fn(),
  exists: vi.fn(),
  subscribe: vi.fn(),
  start: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('../src/workspace-root-ignores.js', () => ({ resolveWorkspaceRootIgnores: fixture.ignores }));
vi.mock('../src/path-exists.js', () => ({ pathExists: fixture.exists }));
vi.mock('../src/root-subscription.js', () => ({
  RootSubscription: class {
    constructor(options: unknown) { fixture.subscribe(options); }
    start() { fixture.start(); }
    async dispose() { fixture.dispose(); }
  },
}));
beforeEach(() => {
  fixture.exists.mockResolvedValue(false);
  vi.spyOn(fs, 'realpath').mockResolvedValue('/workspace');
});
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

it('reports ignore discovery failures and still watches with the available ignores', async () => {
  fixture.ignores.mockResolvedValue({ ignore: ['**/node_modules/**'], failures: ['nested repository unavailable'] });
  const onWatchError = vi.fn();
  const watcher = createWorkspaceStatusWatcher({ cwd: '/workspace', onChange: vi.fn(), onWatchError });
  watcher.start();
  try {
    await vi.waitFor(() => expect(fixture.start).toHaveBeenCalledOnce());
    expect(onWatchError).toHaveBeenCalledWith({
      message: 'Workspace root ignore discovery failed: nested repository unavailable',
      rootPath: '/workspace',
    });
    expect(fixture.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      rootPath: '/workspace', subscribeOptions: { ignore: ['**/node_modules/**'] },
    }));
  } finally { await watcher.dispose(); }
  expect(fixture.dispose).toHaveBeenCalledOnce();
});

it('does not install a subscription or report stale errors when disposed during ignore discovery', async () => {
  let finish!: (value: { ignore: string[]; failures: string[] }) => void;
  const discovery = new Promise<{ ignore: string[]; failures: string[] }>(resolve => { finish = resolve; });
  fixture.ignores.mockReturnValue(discovery);
  const onWatchError = vi.fn();
  const watcher = createWorkspaceStatusWatcher({ cwd: '/workspace', onChange: vi.fn(), onWatchError });
  watcher.start();
  await vi.waitFor(() => expect(fixture.ignores).toHaveBeenCalledOnce());
  await watcher.dispose();
  finish({ ignore: [], failures: ['stale discovery failure'] });
  await discovery;
  await new Promise(resolve => setImmediate(resolve));
  expect(fixture.subscribe).not.toHaveBeenCalled();
  expect(onWatchError).not.toHaveBeenCalled();
});
