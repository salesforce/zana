import { createHostWatcher, type HostWatcher } from '@zana-ai/zcc-host-watcher';

let watcher: HostWatcher | null = null;
const unsubscribers = new Map<string, () => void | Promise<void>>();

export function hostFsWatcher(): HostWatcher {
  watcher ??= createHostWatcher();
  return watcher;
}

export function watchWorkspacePath(
  workspacePath: string,
  environmentId = 'local'
): void {
  if (!workspacePath || unsubscribers.has(workspacePath)) return;
  const unsubscribe = hostFsWatcher().watchWorkspace({
    environmentId,
    workspacePath,
    onChange: () => undefined,
    onReady: () => undefined,
    onWatchError: () => undefined
  });
  unsubscribers.set(workspacePath, unsubscribe);
}

export async function disposeHostFsWatcher(): Promise<void> {
  const pending = [...unsubscribers.values()].map((unsubscribe) => unsubscribe());
  unsubscribers.clear();
  await Promise.all(pending);
  watcher = null;
}
