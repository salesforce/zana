import { createHostWatcher, type HostWatcher } from '@zana-ai/zcc-host-watcher';

let watcher: HostWatcher | null = null;

export function hostFsWatcher(): HostWatcher {
  watcher ??= createHostWatcher();
  return watcher;
}

export async function disposeHostFsWatcher(): Promise<void> {
  watcher = null;
}
