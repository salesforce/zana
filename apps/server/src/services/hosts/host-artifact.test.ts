import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import {
  joinDaemonFileCandidates,
  joinRepoFileCandidates,
  prebuiltJoinBundleDirCandidates,
  resolveHostArtifact,
  resolvePrebuiltJoinBundleDir
} from './host-artifact.js';

function unpackArtifact(): string {
  const artifact = resolveHostArtifact({ ...process.env, ZCC_HOST_ARTIFACT: '' });
  const unpack = mkdtempSync(join(tmpdir(), 'zcc-artifact-unpack-'));
  expect(spawnSync('tar', ['-xzf', artifact.tarballPath, '-C', unpack]).status).toBe(0);
  return unpack;
}

function isolatedNode(args: string[], input?: string) {
  return spawnSync(process.execPath, args, {
    cwd: mkdtempSync(join(tmpdir(), 'zcc-join-isolated-')),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    input,
    timeout: 15_000
  });
}

describe('host-artifact locator', () => {
  const hostsDir = dirname(fileURLToPath(import.meta.url));

  it('finds checkout sources from the vitest module layout', () => {
    const found = joinDaemonFileCandidates('src/join-cli.ts', hostsDir, process.cwd())
      .find((path) => existsSync(path));
    expect(found).toBeTruthy();
    const worker = joinRepoFileCandidates(
      'packages/provider-bridge-protocol/src/bridge-worker-entry.ts',
      hostsDir,
      process.cwd()
    ).find((path) => existsSync(path));
    expect(worker).toBeTruthy();
  });

  it('lists the Electron out/main checkout even when cwd is /', () => {
    const here = join('/repo', 'out', 'main');
    const daemon = joinDaemonFileCandidates('src/join-cli.ts', here, '/');
    expect(daemon).toContain(join('/repo', 'apps', 'host-daemon', 'src', 'join-cli.ts'));
    const repoFile = joinRepoFileCandidates(
      'packages/agent-runtime/src/acp-launch-specs.ts',
      here,
      '/'
    );
    expect(repoFile).toContain(join('/repo', 'packages', 'agent-runtime', 'src', 'acp-launch-specs.ts'));
  });

  it('lists the Electron out/main/chunks checkout even when cwd is /', () => {
    const here = join('/repo', 'out', 'main', 'chunks');
    expect(joinDaemonFileCandidates('scripts/build-join.mjs', here, '/'))
      .toContain(join('/repo', 'apps', 'host-daemon', 'scripts', 'build-join.mjs'));
    expect(joinRepoFileCandidates('packages/agent-runtime/src/provider-registry.ts', here, '/'))
      .toContain(join('/repo', 'packages', 'agent-runtime', 'src', 'provider-registry.ts'));
  });

  it('lists packaged host-bridge and checkout dist as prebuilt dirs', () => {
    const here = join('/repo', 'out', 'main');
    const dirs = prebuiltJoinBundleDirCandidates(here, '/', '/app/Resources');
    expect(dirs).toContain(join('/app', 'Resources', 'host-bridge'));
    expect(dirs).toContain(join('/repo', 'apps', 'host-daemon', 'dist'));
  });

  it('accepts a prebuilt dir only when join.mjs and both bridges are present', () => {
    const resources = mkdtempSync(join(tmpdir(), 'zcc-host-bridge-'));
    const bundled = join(resources, 'host-bridge');
    mkdirSync(bundled);
    writeFileSync(join(bundled, 'bb-provider-bridge-worker.mjs'), 'worker\n');
    writeFileSync(join(bundled, 'bb-pi-bridge.mjs'), 'pi\n');
    expect(resolvePrebuiltJoinBundleDir({
      here: join('/missing', 'out', 'main'),
      cwd: '/',
      resourcesPath: resources
    })).toBeNull();
    writeFileSync(join(bundled, 'join.mjs'), 'join\n');
    expect(resolvePrebuiltJoinBundleDir({
      here: join('/missing', 'out', 'main'),
      cwd: '/',
      resourcesPath: resources
    })).toBe(bundled);
  });

  it('names the missing sources when neither checkout nor prebuilt exist', () => {
    const empty = mkdtempSync(join(tmpdir(), 'zcc-host-empty-'));
    expect(() => resolveHostArtifact(
      { ...process.env, ZCC_HOST_ARTIFACT: '' },
      { here: empty, cwd: empty, resourcesPath: empty }
    )).toThrow(/zcc-host join bundle sources are missing from this checkout \(src\/join-cli\.ts/);
  });

  it('packs a tarball from a prebuilt join bundle when checkout sources are absent', () => {
    const resources = mkdtempSync(join(tmpdir(), 'zcc-prebuilt-pack-'));
    const bundled = join(resources, 'host-bridge');
    mkdirSync(bundled);
    writeFileSync(join(bundled, 'join.mjs'), 'export const join = true;\n');
    writeFileSync(join(bundled, 'bb-provider-bridge-worker.mjs'), 'export const worker = true;\n');
    writeFileSync(join(bundled, 'bb-pi-bridge.mjs'), 'export const pi = true;\n');
    const artifact = resolveHostArtifact(
      { ...process.env, ZCC_HOST_ARTIFACT: '' },
      { here: join(resources, 'out', 'main'), cwd: '/', resourcesPath: resources }
    );
    const unpack = mkdtempSync(join(tmpdir(), 'zcc-prebuilt-unpack-'));
    expect(spawnSync('tar', ['-xzf', artifact.tarballPath, '-C', unpack]).status).toBe(0);
    expect(readFileSync(join(unpack, 'join.mjs'), 'utf8')).toBe('export const join = true;\n');
    expect(existsSync(join(unpack, 'bb-provider-bridge-worker.mjs'))).toBe(true);
    expect(existsSync(join(unpack, 'bb-pi-bridge.mjs'))).toBe(true);
    expect(JSON.parse(readFileSync(join(unpack, 'package.json'), 'utf8')).bin).toEqual({
      'zcc-host': 'join.mjs'
    });
    rmSync(artifact.tarballPath, { force: true });
  });
});

describe('host-artifact', () => {
  it('packs a Node-only join.mjs that can dispatch host RPC', () => {
    const unpack = unpackArtifact();
    expect(resolveHostArtifact({ ...process.env, ZCC_HOST_ARTIFACT: '' }).protocolVersion)
      .toBe(HOST_RPC_PROTOCOL_VERSION);
    const joinScript = readFileSync(join(unpack, 'join.mjs'), 'utf8');
    expect(joinScript).toContain('/internal/hosts/enroll');
    expect(joinScript).toContain('host.list_dir');
    expect(joinScript).toContain('host-rpc.request');
    expect(joinScript).not.toContain('Host artifact response is missing Content-Length');
    // Codex/Claude live in provider plugins; join.mjs inlines the remaining
    // built-in ACP launch specs (Cursor, OpenCode, …).
    expect(joinScript).toMatch(/displayName:\s*"Cursor"/);
    expect(joinScript).toMatch(/command:\s*"cursor-agent"/);
  }, 60_000);

  it('packs the provider-bridge worker so remotes do not resolve workspace packages', () => {
    const unpack = unpackArtifact();
    expect(existsSync(join(unpack, 'bb-provider-bridge-worker.mjs'))).toBe(true);
    expect(existsSync(join(unpack, 'bb-pi-bridge.mjs'))).toBe(true);

    const joinLoad = isolatedNode([join(unpack, 'join.mjs')]);
    expect(joinLoad.status, joinLoad.stderr || joinLoad.stdout).toBe(0);
    expect(`${joinLoad.stderr}${joinLoad.stdout}`).not.toMatch(/Cannot find package '@zana-ai\//);

    const workerUsage = isolatedNode([join(unpack, 'bb-provider-bridge-worker.mjs')]);
    expect(workerUsage.status).not.toBe(0);
    expect(`${workerUsage.stderr}${workerUsage.stdout}`).toMatch(/provider bridge bootstrap usage/);
    expect(`${workerUsage.stderr}${workerUsage.stdout}`).not.toMatch(/Cannot find package '@zana-ai\//);

    const bridge = join(unpack, 'artifact.mjs');
    writeFileSync(bridge, [
      'export const experimental_providerBridge = {',
      '  experimental_apiVersion: 1,',
      '  start() {},',
      '  handleLine() {}',
      '};',
      ''
    ].join('\n'));
    const workerStart = isolatedNode(
      [join(unpack, 'bb-provider-bridge-worker.mjs'), bridge, 'plug', unpack],
      ''
    );
    expect(`${workerStart.stderr}${workerStart.stdout}`).not.toMatch(/Cannot find package '@zana-ai\//);
    expect(workerStart.status, workerStart.stderr || workerStart.stdout).toBe(0);

    const piBridge = readFileSync(join(unpack, 'bb-pi-bridge.mjs'), 'utf8');
    expect(piBridge.match(/^#!/gm) ?? []).toHaveLength(1);
    const piCheck = isolatedNode(['--check', join(unpack, 'bb-pi-bridge.mjs')]);
    expect(piCheck.status, piCheck.stderr || piCheck.stdout).toBe(0);
  }, 60_000);
});
