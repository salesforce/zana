import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOST_RPC_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/host-rpc';
import {
  SELF_UPDATE_INITIAL_RETRY_DELAY_MS,
  handleProtocolMismatch
} from './protocol-self-update.js';

describe('protocol self-update', () => {
  it('skips when disabled or remote protocol is not newer', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-self-update-'));
    await expect(handleProtocolMismatch({
      dataDir,
      serverUrl: 'http://127.0.0.1:1',
      enabled: false
    })).resolves.toBe('skipped');
    await expect(handleProtocolMismatch({
      dataDir,
      serverUrl: 'http://127.0.0.1:1',
      enabled: true,
      fetchFn: async () => new Response(JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION }), { status: 200 })
    })).resolves.toBe('skipped');
  });

  it('downloads a newer tarball and honors backoff', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-self-update-'));
    const fetches: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      fetches.push(url);
      if (url.endsWith('/install/version')) {
        return new Response(JSON.stringify({ protocolVersion: HOST_RPC_PROTOCOL_VERSION + 1 }), { status: 200 });
      }
      return new Response(Buffer.from('tarball'), { status: 200 });
    };
    await expect(handleProtocolMismatch({
      dataDir,
      serverUrl: 'http://127.0.0.1:8780/',
      enabled: true,
      now: 1_000,
      fetchFn
    })).resolves.toBe('updated');
    expect(readFileSync(join(dataDir, 'runtime', 'zcc-host.tgz'), 'utf8')).toBe('tarball');
    await expect(handleProtocolMismatch({
      dataDir,
      serverUrl: 'http://127.0.0.1:8780/',
      enabled: true,
      now: 1_000 + SELF_UPDATE_INITIAL_RETRY_DELAY_MS - 1,
      fetchFn
    })).resolves.toBe('backoff');
    await expect(handleProtocolMismatch({
      dataDir,
      serverUrl: 'http://127.0.0.1:8780/',
      enabled: true,
      force: true,
      now: 1_000,
      fetchFn
    })).resolves.toBe('updated');
  });
});
