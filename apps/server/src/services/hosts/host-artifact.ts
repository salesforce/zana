import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
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

/** Overrideable roots so tests can simulate Electron `out/main` + cwd `/`. */
export interface HostArtifactLocator {
  here: string;
  cwd: string;
  resourcesPath?: string | null;
}

const JOIN_DAEMON_SOURCE_FILES = [
  'src/join-cli.ts',
  'src/enroll.ts',
  'src/enroll-runtime.ts',
  'src/server-url.ts',
  'src/pty-pipe-shim.ts',
  'src/better-sqlite3-stub.ts',
  'scripts/build-join.mjs',
  'src/server-connection.ts',
  'src/plugin-host-artifact-client.ts',
  'src/plugin-tool-call-client.ts',
  'src/interactive-request-client.ts'
] as const;

const JOIN_REPO_SOURCE_FILES = [
  'packages/provider-bridge-protocol/src/bridge-worker-entry.ts',
  'packages/agent-runtime/src/pi/bridge/bridge.ts',
  'packages/agent-runtime/src/acp-launch-specs.ts',
  'packages/agent-runtime/src/provider-registry.ts'
] as const;

const PREBUILT_JOIN_FILES = [
  'join.mjs',
  'bb-provider-bridge-worker.mjs',
  'bb-pi-bridge.mjs'
] as const;

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

function processResourcesPath(): string | null {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resources === 'string' && resources.length > 0 ? resources : null;
}

export function defaultHostArtifactLocator(): HostArtifactLocator {
  return {
    here: dirname(fileURLToPath(import.meta.url)),
    cwd: process.cwd(),
    resourcesPath: processResourcesPath()
  };
}

/**
 * Host-daemon files relative to this module. Depths cover:
 * `apps/server/src/services/hosts` (vitest), `out/main` (Electron server-runtime),
 * and `out/main/chunks`. `cwd` is last because a utilityProcess often starts at `/`.
 */
export function joinDaemonFileCandidates(relPath: string, here: string, cwd: string): string[] {
  return unique([
    join(here, '../../../host-daemon', relPath),
    join(here, '../../../../apps/host-daemon', relPath),
    join(here, '../../apps/host-daemon', relPath),
    join(here, '../../../apps/host-daemon', relPath),
    join(cwd, 'apps/host-daemon', relPath)
  ]);
}

export function joinRepoFileCandidates(relPath: string, here: string, cwd: string): string[] {
  return unique([
    join(here, '../../../../', relPath),
    join(here, '../../../../../', relPath),
    join(here, '../..', relPath),
    join(here, '../../..', relPath),
    join(cwd, relPath)
  ]);
}

export function prebuiltJoinBundleDirCandidates(
  here: string,
  cwd: string,
  resourcesPath?: string | null
): string[] {
  return unique([
    ...(resourcesPath ? [join(resourcesPath, 'host-bridge')] : []),
    join(cwd, 'apps/host-daemon/dist'),
    join(here, '../../../host-daemon/dist'),
    join(here, '../../apps/host-daemon/dist'),
    join(here, '../../../apps/host-daemon/dist'),
    join(here, '../../../../apps/host-daemon/dist')
  ]);
}

export function resolvePrebuiltJoinBundleDir(
  locator: HostArtifactLocator,
  exists: (path: string) => boolean = existsSync
): string | null {
  for (const dir of prebuiltJoinBundleDirCandidates(locator.here, locator.cwd, locator.resourcesPath)) {
    if (PREBUILT_JOIN_FILES.every((file) => exists(join(dir, file)))) return dir;
  }
  return null;
}

function firstExisting(paths: string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}

function hostDaemonVersion(): string {
  try {
    const pkg = nodeRequire('@zana-ai/zcc-host-daemon/package.json') as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    return '0.1.0';
  }
}

interface ArtifactInputs {
  joinCli: string;
  enroll: string;
  enrollRuntime: string;
  serverUrl: string;
  shim: string;
  sqliteStub: string;
  bundleScript: string;
  workerEntry: string;
  piBridge: string;
  serverConnection: string;
  pluginHostArtifactClient: string;
  pluginToolCallClient: string;
  interactiveRequestClient: string;
  acpLaunchSpecs: string;
  providerRegistry: string;
}

function locateArtifactInputs(
  locator: HostArtifactLocator
): { ok: true; inputs: ArtifactInputs } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const daemon = (relPath: (typeof JOIN_DAEMON_SOURCE_FILES)[number]): string | null => {
    const found = firstExisting(joinDaemonFileCandidates(relPath, locator.here, locator.cwd));
    if (!found) missing.push(relPath);
    return found;
  };
  const repo = (relPath: (typeof JOIN_REPO_SOURCE_FILES)[number]): string | null => {
    const found = firstExisting(joinRepoFileCandidates(relPath, locator.here, locator.cwd));
    if (!found) missing.push(relPath);
    return found;
  };
  const joinCli = daemon('src/join-cli.ts');
  const enroll = daemon('src/enroll.ts');
  const enrollRuntime = daemon('src/enroll-runtime.ts');
  const serverUrl = daemon('src/server-url.ts');
  const shim = daemon('src/pty-pipe-shim.ts');
  const sqliteStub = daemon('src/better-sqlite3-stub.ts');
  const bundleScript = daemon('scripts/build-join.mjs');
  const serverConnection = daemon('src/server-connection.ts');
  const pluginHostArtifactClient = daemon('src/plugin-host-artifact-client.ts');
  const pluginToolCallClient = daemon('src/plugin-tool-call-client.ts');
  const interactiveRequestClient = daemon('src/interactive-request-client.ts');
  const workerEntry = repo('packages/provider-bridge-protocol/src/bridge-worker-entry.ts');
  const piBridge = repo('packages/agent-runtime/src/pi/bridge/bridge.ts');
  const acpLaunchSpecs = repo('packages/agent-runtime/src/acp-launch-specs.ts');
  const providerRegistry = repo('packages/agent-runtime/src/provider-registry.ts');
  if (
    missing.length > 0
    || !joinCli || !enroll || !enrollRuntime || !serverUrl || !shim || !sqliteStub || !bundleScript
    || !workerEntry || !piBridge || !serverConnection || !pluginHostArtifactClient
    || !pluginToolCallClient || !interactiveRequestClient
    || !acpLaunchSpecs || !providerRegistry
  ) {
    return {
      ok: false,
      missing: missing.length > 0 ? missing : [...JOIN_DAEMON_SOURCE_FILES, ...JOIN_REPO_SOURCE_FILES]
    };
  }
  return {
    ok: true,
    inputs: {
      joinCli,
      enroll,
      enrollRuntime,
      serverUrl,
      shim,
      sqliteStub,
      bundleScript,
      workerEntry,
      piBridge,
      serverConnection,
      pluginHostArtifactClient,
      pluginToolCallClient,
      interactiveRequestClient,
      acpLaunchSpecs,
      providerRegistry
    }
  };
}

function artifactStamp(inputs: ArtifactInputs): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(inputs.joinCli));
  hash.update(readFileSync(inputs.enroll));
  hash.update(readFileSync(inputs.enrollRuntime));
  hash.update(readFileSync(inputs.serverUrl));
  hash.update(readFileSync(inputs.shim));
  hash.update(readFileSync(inputs.sqliteStub));
  hash.update(readFileSync(inputs.bundleScript));
  hash.update(readFileSync(inputs.workerEntry));
  hash.update(readFileSync(inputs.piBridge));
  hash.update(readFileSync(inputs.serverConnection));
  hash.update(readFileSync(inputs.pluginHostArtifactClient));
  hash.update(readFileSync(inputs.pluginToolCallClient));
  hash.update(readFileSync(inputs.interactiveRequestClient));
  // join.mjs inlines BUILT_IN_ACP_LAUNCH_SPECS. A Codex row added there must
  // bust the cached tarball or enrolled remotes keep packing thread/start
  // without acpLaunchSpec and the ACP bridge rejects the turn.
  hash.update(readFileSync(inputs.acpLaunchSpecs));
  hash.update(readFileSync(inputs.providerRegistry));
  hash.update(String(HOST_RPC_PROTOCOL_VERSION));
  hash.update('join-bridge-worker');
  return hash.digest('hex').slice(0, 8);
}

function prebuiltStamp(bundleDir: string): string {
  const hash = createHash('sha256');
  for (const file of PREBUILT_JOIN_FILES) {
    hash.update(readFileSync(join(bundleDir, file)));
  }
  hash.update(String(HOST_RPC_PROTOCOL_VERSION));
  hash.update('prebuilt-join-bundle');
  return hash.digest('hex').slice(0, 8);
}

function cachedTarballPath(version: string, stamp: string): string {
  return join(tmpdir(), `zcc-host-artifact-${version}-${HOST_RPC_PROTOCOL_VERSION}-${stamp}.tgz`);
}

function writeJoinPackageJson(dir: string): void {
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'zcc-host',
      version: hostDaemonVersion(),
      type: 'module',
      bin: { 'zcc-host': 'join.mjs' }
    }, null, 2)
  );
}

function tarJoinDir(tarball: string, dir: string): void {
  const packed = spawnSync(
    'tar',
    ['-czf', tarball, '-C', dir, 'package.json', ...PREBUILT_JOIN_FILES],
    { encoding: 'utf8' }
  );
  if (packed.status !== 0 || !existsSync(tarball)) {
    throw new Error(packed.stderr || 'failed to pack zcc-host artifact');
  }
}

/**
 * Serve the host-daemon join artifact this server was built with so a remote
 * machine cannot be stranded on a different protocol. The tarball is an
 * esbuild bundle of join-cli (Node ESM, no tsx) plus the provider-bridge
 * worker and Pi bridge, with node-pty swapped for a pipe shim so Linux
 * remotes do not need this laptop's native addon.
 */
export function resolveHostArtifact(
  env: NodeJS.ProcessEnv = process.env,
  locator: HostArtifactLocator = defaultHostArtifactLocator()
): HostArtifactInfo {
  const override = env.ZCC_HOST_ARTIFACT?.trim();
  if (override && existsSync(override)) {
    return {
      version: hostDaemonVersion(),
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      tarballPath: override
    };
  }
  const version = hostDaemonVersion();
  const located = locateArtifactInputs(locator);
  if (located.ok) {
    const stamp = artifactStamp(located.inputs);
    const cached = cachedTarballPath(version, stamp);
    if (!existsSync(cached)) {
      packJoinArtifact(cached, located.inputs.bundleScript);
    }
    return {
      version,
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      tarballPath: cached
    };
  }
  const prebuilt = resolvePrebuiltJoinBundleDir(locator);
  if (prebuilt) {
    const stamp = prebuiltStamp(prebuilt);
    const cached = cachedTarballPath(version, stamp);
    if (!existsSync(cached)) {
      packPrebuiltArtifact(cached, prebuilt);
    }
    return {
      version,
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      tarballPath: cached
    };
  }
  throw new Error(
    `zcc-host join bundle sources are missing from this checkout (${located.missing.join(', ')})`
  );
}

function packJoinArtifact(tarball: string, bundleScript: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-host-artifact-'));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  writeJoinPackageJson(dir);
  const outfile = join(dir, 'join.mjs');
  const packedJs = spawnSync(process.execPath, [bundleScript, '--outfile', outfile], {
    encoding: 'utf8'
  });
  const worker = join(dir, 'bb-provider-bridge-worker.mjs');
  const piBridge = join(dir, 'bb-pi-bridge.mjs');
  if (packedJs.status !== 0 || !existsSync(outfile) || !existsSync(worker) || !existsSync(piBridge)) {
    throw new Error(packedJs.stderr || packedJs.stdout || 'failed to bundle zcc-host join.mjs');
  }
  tarJoinDir(tarball, dir);
}

function packPrebuiltArtifact(tarball: string, bundleDir: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-host-artifact-'));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  writeJoinPackageJson(dir);
  for (const file of PREBUILT_JOIN_FILES) {
    copyFileSync(join(bundleDir, file), join(dir, file));
  }
  tarJoinDir(tarball, dir);
}

export function createHostArtifactReadStream(path: string): ReturnType<typeof createReadStream> {
  return createReadStream(path);
}
