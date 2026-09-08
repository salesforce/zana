import { describe, expect, it, vi } from 'vitest';

vi.mock('@zana-ai/zcc-host-watcher', () => {
  const watched: string[] = [];
  return {
    createHostWatcher: () => ({
      watchWorkspace(args: { workspacePath: string }) {
        watched.push(args.workspacePath);
        return () => {
          const index = watched.indexOf(args.workspacePath);
          if (index >= 0) watched.splice(index, 1);
        };
      },
      watchThreadStorageRoot() {
        return () => undefined;
      }
    }),
    watched
  };
});

describe('workspace-fs-watch', () => {
  it('watches a workspace path once and disposes the watcher', async () => {
    const { watchWorkspacePath, disposeHostFsWatcher } = await import('./workspace-fs-watch.js');
    const { watched } = await import('@zana-ai/zcc-host-watcher') as unknown as { watched: string[] };
    watchWorkspacePath('/tmp/zcc-workspace-a');
    watchWorkspacePath('/tmp/zcc-workspace-a');
    expect(watched).toEqual(['/tmp/zcc-workspace-a']);
    await disposeHostFsWatcher();
    expect(watched).toEqual([]);
  });
});
