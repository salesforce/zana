import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { createRequire } from 'node:module';

// Electron-Vite emits an ESM `require` shim for the main bundle. Keep this
// module-local resolver distinct so the bundled declarations cannot collide.
const nodeRequire = createRequire(import.meta.url);

export interface HostArtifactInfo {
  version: string;
  protocolVersion: number;
  tarballPath: string;
}

function hostDaemonVersion(): string {
  try {
    const pkg = nodeRequire('@zana-ai/zcc-host-daemon/package.json') as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function checkoutFile(relPath: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../host-daemon', relPath),
    join(here, '../../../../apps/host-daemon', relPath),
    join(process.cwd(), 'apps/host-daemon', relPath)
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function checkoutRepoFile(relPath: string): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../../', relPath),
    join(here, '../../../../../', relPath),
    join(process.cwd(), relPath)
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

interface ArtifactInputs {
  joinCli: string;
  shim: string;
  sqliteStub: string;
  bundleScript: string;
  workerEntry: string;
  piBridge: string;
  serverConnection: string;
}

function artifactInputs(): ArtifactInputs {
  const joinCli = checkoutFile('src/join-cli.ts');
  const shim = checkoutFile('src/pty-pipe-shim.ts');
  const sqliteStub = checkoutFile('src/better-sqlite3-stub.ts');
  const bundleScript = checkoutFile('scripts/build-join.mjs');
  const serverConnection = checkoutFile('src/server-connection.ts');
  const workerEntry = checkoutRepoFile('packages/provider-bridge-protocol/src/bridge-worker-entry.ts');
  const piBridge = checkoutRepoFile('packages/agent-runtime/src/pi/bridge/bridge.ts');
  if (!joinCli || !shim || !sqliteStub || !bundleScript || !workerEntry || !piBridge || !serverConnection) {
    throw new Error('zcc-host join bundle sources are missing from this checkout');
  }
  return { joinCli, shim, sqliteStub, bundleScript, workerEntry, piBridge, serverConnection };
}

function artifactStamp(inputs: ArtifactInputs): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(inputs.joinCli));
  hash.update(readFileSync(inputs.shim));
  hash.update(readFileSync(inputs.sqliteStub));
  hash.update(readFileSync(inputs.bundleScript));
  hash.update(readFileSync(inputs.workerEntry));
  hash.update(readFileSync(inputs.piBridge));
  hash.update(readFileSync(inputs.serverConnection));
  hash.update(String(HOST_RPC_PROTOCOL_VERSION));
  hash.update('join-bridge-worker');
  return hash.digest('hex').slice(0, 8);
}

function cachedTarballPath(version: string, stamp: string): string {
  return join(tmpdir(), `zcc-host-artifact-${version}-${HOST_RPC_PROTOCOL_VERSION}-${stamp}.tgz`);
}

/**
 * Serve the host-daemon join artifact this server was built with so a remote
 * machine cannot be stranded on a different protocol. The tarball is an
 * esbuild bundle of join-cli (Node ESM, no tsx) plus the provider-bridge
 * worker and Pi bridge, with node-pty swapped for a pipe shim so Linux
 * remotes do not need this laptop's native addon.
 */
export function resolveHostArtifact(env: NodeJS.ProcessEnv = process.env): HostArtifactInfo {
  const override = env.ZCC_HOST_ARTIFACT?.trim();
  if (override && existsSync(override)) {
    return {
      version: hostDaemonVersion(),
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      tarballPath: override
    };
  }
  const version = hostDaemonVersion();
  const inputs = artifactInputs();
  const stamp = artifactStamp(inputs);
  const cached = cachedTarballPath(version, stamp);
  if (!existsSync(cached)) {
    packJoinArtifact(cached, inputs.bundleScript);
  }
  return {
    version,
    protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    tarballPath: cached
  };
}

function packJoinArtifact(tarball: string, bundleScript: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-host-artifact-'));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'zcc-host',
      version: hostDaemonVersion(),
      type: 'module',
      bin: { 'zcc-host': 'join.mjs' }
    }, null, 2)
  );
  const outfile = join(dir, 'join.mjs');
  const packedJs = spawnSync(process.execPath, [bundleScript, '--outfile', outfile], {
    encoding: 'utf8'
  });
  const worker = join(dir, 'bb-provider-bridge-worker.mjs');
  const piBridge = join(dir, 'bb-pi-bridge.mjs');
  if (packedJs.status !== 0 || !existsSync(outfile) || !existsSync(worker) || !existsSync(piBridge)) {
    throw new Error(packedJs.stderr || packedJs.stdout || 'failed to bundle zcc-host join.mjs');
  }
  const packed = spawnSync(
    'tar',
    ['-czf', tarball, '-C', dir, 'package.json', 'join.mjs', 'bb-provider-bridge-worker.mjs', 'bb-pi-bridge.mjs'],
    { encoding: 'utf8' }
  );
  if (packed.status !== 0 || !existsSync(tarball)) {
    throw new Error(packed.stderr || 'failed to pack zcc-host artifact');
  }
}

export function createHostArtifactReadStream(path: string): ReturnType<typeof createReadStream> {
  return createReadStream(path);
}
