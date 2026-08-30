import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { resolveHostArtifact } from './host-artifact.js';

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

describe('host-artifact', () => {
  it('packs a Node-only join.mjs that can dispatch host RPC', () => {
    const unpack = unpackArtifact();
    expect(resolveHostArtifact({ ...process.env, ZCC_HOST_ARTIFACT: '' }).protocolVersion)
      .toBe(HOST_RPC_PROTOCOL_VERSION);
    const joinScript = readFileSync(join(unpack, 'join.mjs'), 'utf8');
    expect(joinScript).toContain('/internal/hosts/enroll');
    expect(joinScript).toContain('host.list_dir');
    expect(joinScript).toContain('host-rpc.request');
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
