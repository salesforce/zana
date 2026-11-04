import { spawn } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute, dirname } from 'node:path';
import { acquireDaemonLock } from './lock.js';
import { readHostAuth } from './machine-auth.js';

/** Restart a background-only installation with its existing machine identity.
 * Service-managed installs use their manager instead. The lock verifies both
 * recorded command and start time before signalling any surviving owner. */
export async function restartInstalledHost(dataDir: string, entry: string): Promise<void> {
  const runtime = realpathSync(join(dataDir, 'runtime'));
  const contained = relative(runtime, realpathSync(entry));
  if (contained === '..' || contained.startsWith('../') || isAbsolute(contained)) throw new Error('Host launcher is outside the installed runtime');
  const auth = readHostAuth(dataDir);
  if (!auth) throw new Error('Host enrollment is missing; install the machine first');
  const port = Number(readFileSync(join(dataDir, 'host-daemon.port'), 'utf8').trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid installed host port');
  let serverUrl = auth.serverUrl;
  // Older installations did not save serverUrl with auth. Their authenticated
  // daemon identity must match before its loopback status can supply the URL.
  if (!serverUrl) {
    const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(3_000), redirect: 'error' });
    const reader = response.body?.getReader();
    if (!response.ok || !reader) { await response.body?.cancel(); throw new Error('Cannot recover installed host address'); }
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 4096) throw new Error('Cannot recover installed host address');
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const text = Buffer.concat(chunks).toString('utf8');
    const status = JSON.parse(text);
    if (status.hostId !== auth.hostId) throw new Error('Installed host identity does not match');
    serverUrl = status.serverUrl;
  }
  const url = new URL(serverUrl!);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid installed host address');
  // A legacy PID-only lock fails closed; it is never permission to kill a PID.
  const release = acquireDaemonLock(dataDir, { steal: true });
  release();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [entry, 'join', '--host-id', auth.hostId,
      '--server-url', url.toString(), '--host-daemon-port', String(port), '--auto-update'], {
      detached: true, stdio: 'ignore', cwd: dataDir, windowsHide: true,
      env: { ...process.env, ZCC_DATA_DIR: dataDir, ZCC_HOST_SERVICE_MANAGED: '0', PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}` }
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
