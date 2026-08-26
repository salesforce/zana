import { createReadStream, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export interface HostArtifactInfo {
  version: string;
  protocolVersion: number;
  tarballPath: string;
}

function hostDaemonVersion(): string {
  try {
    const pkg = require('@zana-ai/zcc-host-daemon/package.json') as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

function joinCliPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '../../../host-daemon/src/join-cli.ts'),
    join(here, '../../../../apps/host-daemon/src/join-cli.ts'),
    join(process.cwd(), 'apps/host-daemon/src/join-cli.ts')
  ];
  return candidates.find((path) => existsSync(path)) ?? null;
}

function cachedTarballPath(version: string): string {
  return join(tmpdir(), `zcc-host-artifact-${version}-${HOST_RPC_PROTOCOL_VERSION}.tgz`);
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
  const cached = cachedTarballPath(version);
  if (!existsSync(cached)) {
    packJoinArtifact(cached);
  }
  return {
    version,
    protocolVersion: HOST_RPC_PROTOCOL_VERSION,
    tarballPath: cached
  };
}

function packJoinArtifact(tarball: string): void {
  const source = joinCliPath();
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
  const launcher = `#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const envCli = process.env.ZCC_HOST_JOIN_CLI;
const bundled = join(here, 'join-cli.ts');
const joinCli = (envCli && existsSync(envCli) ? envCli : null)
  ?? ${source ? JSON.stringify(source) : 'null'}
  ?? (existsSync(bundled) ? bundled : null);
if (!joinCli) {
  console.error('zcc-host join CLI is missing from this artifact');
  process.exit(1);
}
const child = spawn(process.execPath, ['--import', 'tsx', joinCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env
});
child.on('exit', (code) => process.exit(code ?? 1));
`;
  writeFileSync(join(dir, 'join.mjs'), launcher, { mode: 0o755 });
  if (source) {
    writeFileSync(join(dir, 'join-cli.ts'), `export * from ${JSON.stringify(source)};\n`, { mode: 0o644 });
  }
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
