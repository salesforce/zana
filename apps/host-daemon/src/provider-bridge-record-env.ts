import { join } from 'node:path';

/** Keep in lockstep with `PROVIDER_BRIDGE_RECORD_DIR_ENV` in the bridge kit. */
export const PROVIDER_BRIDGE_RECORD_DIR_ENV = 'ZCC_PROVIDER_BRIDGE_RECORD_DIR';

export function defaultProviderBridgeRecordDir(dataDir: string): string {
  return join(dataDir, 'provider-recordings', 'raw');
}

/**
 * First-seen `ZCC_PROVIDER_BRIDGE_RECORD_DIR` on this process, captured before
 * Settings writes the default path. A boot/dev export wins over the toggle for
 * the lifetime of the daemon; tests call `resetProviderBridgeRecordDirEnvSync`.
 */
let capturedBootDir: string | null | undefined;

export function resetProviderBridgeRecordDirEnvSync(): void {
  capturedBootDir = undefined;
}

/**
 * Keep the daemon process env in lockstep with Settings so the next provider
 * spawn (which copies `process.env`) records or stops recording. Does not
 * restart already-running bridges.
 */
export function syncProviderBridgeRecordDirEnv(args: {
  enabled: boolean;
  dataDir: string;
  env: NodeJS.ProcessEnv;
}): void {
  if (capturedBootDir === undefined) {
    const boot = args.env[PROVIDER_BRIDGE_RECORD_DIR_ENV]?.trim();
    capturedBootDir = boot ? boot : null;
  }
  if (capturedBootDir) return;

  if (args.enabled) {
    args.env[PROVIDER_BRIDGE_RECORD_DIR_ENV] = defaultProviderBridgeRecordDir(args.dataDir);
    return;
  }
  delete args.env[PROVIDER_BRIDGE_RECORD_DIR_ENV];
}
