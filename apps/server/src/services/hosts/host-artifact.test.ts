import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import { resolveHostArtifact } from './host-artifact.js';

describe('host-artifact', () => {
  it('packs a Node-only join.mjs with the current protocol version', () => {
    const artifact = resolveHostArtifact({ ...process.env, ZCC_HOST_ARTIFACT: '' });
    expect(artifact.protocolVersion).toBe(HOST_RPC_PROTOCOL_VERSION);
    const unpack = mkdtempSync(join(tmpdir(), 'zcc-artifact-unpack-'));
    expect(spawnSync('tar', ['-xzf', artifact.tarballPath, '-C', unpack]).status).toBe(0);
    const joinScript = readFileSync(join(unpack, 'join.mjs'), 'utf8');
    expect(joinScript).toContain(`const PROTOCOL_VERSION = ${HOST_RPC_PROTOCOL_VERSION};`);
    expect(joinScript).not.toContain('--import');
    expect(joinScript).not.toMatch(/['"]tsx['"]/);
    expect(joinScript).toContain('/internal/hosts/enroll');
  });
});
