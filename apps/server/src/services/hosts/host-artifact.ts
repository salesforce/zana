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

function joinStandalonePath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../host-daemon/src/join-standalone.mjs'),
    join(here, '../../../../apps/host-daemon/src/join-standalone.mjs'),
    join(process.cwd(), 'apps/host-daemon/src/join-standalone.mjs')
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function artifactStamp(source: string): string {
  return createHash('sha256').update(readFileSync(source)).digest('hex').slice(0, 8);
}

function cachedTarballPath(version: string, stamp: string): string {
  return join(tmpdir(), `zcc-host-artifact-${version}-${HOST_RPC_PROTOCOL_VERSION}-${stamp}.tgz`);
}

/**
 * Serve the exact host-daemon join artifact this server was built with so a
 * remote machine cannot be stranded on a different protocol.
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
  const source = joinStandalonePath();
  if (!source) {
    throw new Error('zcc-host join standalone is missing from this checkout');
  }
  const stamp = artifactStamp(source);
  const cached = cachedTarballPath(version, stamp);
  if (!existsSync(cached)) {
    packJoinArtifact(cached, source);
  }
  return {
    version,
    protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    tarballPath: cached
  };
}

function packJoinArtifact(tarball: string, source: string): void {
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
  const script = readFileSync(source, 'utf8').replace(
    /const PROTOCOL_VERSION = \d+;/,
    `const PROTOCOL_VERSION = ${HOST_RPC_PROTOCOL_VERSION};`
  );
  writeFileSync(join(dir, 'join.mjs'), script, { mode: 0o755 });
  const packed = spawnSync('tar', ['-czf', tarball, '-C', dir, 'package.json', 'join.mjs'], {
    encoding: 'utf8'
  });
  if (packed.status !== 0 || !existsSync(tarball)) {
    throw new Error(packed.stderr || 'failed to pack zcc-host artifact');
  }
}

export function createHostArtifactReadStream(path: string): ReturnType<typeof createReadStream> {
  return createReadStream(path);
}
