import { spawnPortableProcess } from '@zana-ai/zcc-agent-process-utils';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCodexNativeAuth } from './codex-auth-native.js';
import { readCodexAuthCredentials } from './codex-auth.js';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});

const dirs: string[] = [];
const pids: number[] = [];
const fixture = fileURLToPath(new URL('../../../e2e/fixtures/codex-auth.cjs', import.meta.url));
const spawnImpl: typeof spawnPortableProcess = (request) => {
  expect(request.command).toBe('codex');
  expect(request.stdio).toEqual(['pipe', expect.any(Number), 'ignore']);
  const child = spawnPortableProcess({ ...request, command: process.execPath, args: [fixture, ...request.args] });
  if (child.pid) pids.push(child.pid);
  return child;
};

async function home(mode = 'success') {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-native-test-'));
  dirs.push(dir);
  await writeFile(join(dir, 'mode'), mode);
  return dir;
}

afterEach(async () => {
  // Even failures must reap the helper and remove its token-bearing capture.
  for (const pid of pids.splice(0)) expect(() => process.kill(pid, 0)).toThrow();
  const calls = vi.mocked(mkdtemp).mock.calls;
  const results = vi.mocked(mkdtemp).mock.results;
  for (let i = 0; i < calls.length; i++) {
    if (String(calls[i]![0]).includes('zcc-codex-auth-') && results[i]?.type === 'return') {
      await expect(access(await results[i]!.value)).rejects.toMatchObject({ code: 'ENOENT' });
    }
  }
  vi.mocked(mkdtemp).mockClear();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('Codex native authentication', () => {
  it('retrieves a saved API key with a private capture beyond 8 KiB and correct host environment', async () => {
    const dir = await home();
    expect(JSON.parse((await readCodexNativeAuth(dir, {
      spawnImpl, env: { ...process.env, HOME: dir, CODEX_HOME: '/wrong-home' }
    }))!)).toEqual({ auth_mode: 'apikey', OPENAI_API_KEY: 'synthetic-e2e-key' });
    const call = JSON.parse((await readFile(join(dir, 'calls.ndjson'), 'utf8')).trim());
    expect(call).toMatchObject({ home: dir, codexHome: dir, outputMode: 0o600 });
  });

  it.each(['chatgpt', 'chatgptAuthTokens'])('preserves %s credentials and their account claims', async (mode) => {
    const dir = await home(mode);
    await writeFile(join(dir, 'config.toml'), 'cli_auth_credentials_store = "keyring"');
    expect(await readCodexAuthCredentials({ env: { CODEX_HOME: dir },
      readKeyring: (path) => readCodexNativeAuth(path, { spawnImpl })
    })).toMatchObject({ type: 'chatgpt', accountId: 'acct_fixture', accountEmail: 'voice@example.com' });
  });

  it('returns missing only when Codex explicitly reports no login', async () => {
    expect(await readCodexNativeAuth(await home('missing'), { spawnImpl })).toBeNull();
  });

  it.each(['init-error', 'error', 'malformed', 'invalid', 'no-token', 'unsupported', 'exit', 'overflow'])(
    'sanitizes %s failures and cleans up capture and process', async (mode) => {
      await expect(readCodexNativeAuth(await home(mode), { spawnImpl })).rejects.toMatchObject({
        code: 'codex_keyring_unavailable', message: expect.not.stringContaining('synthetic-private')
      });
    }
  );

  it('distinguishes a timeout from a locked Keychain', async () => {
    await expect(readCodexNativeAuth(await home('timeout'), { spawnImpl, timeoutMs: 150 })).rejects.toMatchObject({
      code: 'codex_keyring_unavailable', message: expect.stringContaining('Timed out')
    });
  });

  it('sanitizes synchronous spawn failures', async () => {
    await expect(readCodexNativeAuth(await home(), {
      spawnImpl: () => { throw new Error('synthetic-private-token'); }
    })).rejects.toMatchObject({ code: 'codex_keyring_unavailable', message: expect.not.stringContaining('synthetic-private') });
  });

  it('handles a missing Codex executable without leaking process errors', async () => {
    await expect(readCodexNativeAuth(await home(), { spawnImpl: (request) => spawnPortableProcess({
      ...request, command: '/missing/codex-executable'
    }) })).rejects.toMatchObject({ code: 'codex_keyring_unavailable' });
  });
});
