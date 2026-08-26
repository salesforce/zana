import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';

export const SELF_UPDATE_INITIAL_RETRY_DELAY_MS = 5_000;
export const SELF_UPDATE_MAX_RETRY_DELAY_MS = 5 * 60 * 1000;

interface UpdateAttempt {
  attemptedAt: number;
  attemptCount: number;
  protocolVersion: number;
}

export type ProtocolSelfUpdateResult = 'failed' | 'skipped' | 'updated' | 'backoff';

export async function handleProtocolMismatch(options: {
  dataDir: string;
  serverUrl: string;
  enabled: boolean;
  force?: boolean;
  now?: number;
  fetchFn?: typeof fetch;
}): Promise<ProtocolSelfUpdateResult> {
  if (!options.enabled) return 'skipped';
  const now = options.now ?? Date.now();
  const attemptFile = join(options.dataDir, 'host-daemon-update-attempt.json');
  let previous: UpdateAttempt | null = null;
  try {
    previous = JSON.parse(readFileSync(attemptFile, 'utf8')) as UpdateAttempt;
  } catch {
    previous = null;
  }
  if (!options.force && previous) {
    const delay = Math.min(
      SELF_UPDATE_INITIAL_RETRY_DELAY_MS * 2 ** Math.max(0, previous.attemptCount - 1),
      SELF_UPDATE_MAX_RETRY_DELAY_MS
    );
    if (now - previous.attemptedAt < delay) return 'backoff';
  }
  const fetchFn = options.fetchFn ?? fetch;
  const versionUrl = new URL('/install/version', options.serverUrl);
  const versionResponse = await fetchFn(versionUrl);
  if (!versionResponse.ok) return 'failed';
  const body = (await versionResponse.json()) as { protocolVersion?: number };
  const remote = body.protocolVersion;
  if (typeof remote !== 'number' || remote <= HOST_RPC_PROTOCOL_VERSION) {
    return 'skipped';
  }
  const tarballResponse = await fetchFn(new URL('/install/zcc-host.tgz', options.serverUrl));
  if (!tarballResponse.ok) {
    persistAttempt(attemptFile, previous, now, remote);
    return 'failed';
  }
  const bytes = Buffer.from(await tarballResponse.arrayBuffer());
  mkdirSync(join(options.dataDir, 'runtime'), { recursive: true, mode: 0o755 });
  writeFileSync(join(options.dataDir, 'runtime', 'zcc-host.tgz'), bytes, { mode: 0o600 });
  persistAttempt(attemptFile, previous, now, remote);
  return 'updated';
}

function persistAttempt(
  attemptFile: string,
  previous: UpdateAttempt | null,
  now: number,
  protocolVersion: number
): void {
  mkdirSync(dirname(attemptFile), { recursive: true, mode: 0o700 });
  writeFileSync(
    attemptFile,
    JSON.stringify({
      attemptedAt: now,
      attemptCount: (previous?.attemptCount ?? 0) + 1,
      protocolVersion
    } satisfies UpdateAttempt),
    { encoding: 'utf8', mode: 0o600 }
  );
}
