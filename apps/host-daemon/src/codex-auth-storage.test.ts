import { spawnPortableProcess } from '@zana-ai/zcc-agent-process-utils';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCodexKeyring, readStoredCodexAuth } from './codex-auth-storage.js';
import { resolveVoiceAuth } from './codex-auth.js';
import { HostCommandError } from './host-command-error.js';

const dirs: string[] = [];
const auth = { auth_mode: 'apikey', OPENAI_API_KEY: 'synthetic-key' };
async function home(config?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-auth-storage-'));
  dirs.push(dir);
  if (config !== undefined) await writeFile(join(dir, 'config.toml'), config);
  return dir;
}
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe('Codex credential storage', () => {
  it('uses file storage by default without requesting Keychain access', async () => {
    const dir = await home();
    await writeFile(join(dir, 'auth.json'), JSON.stringify(auth));
    const read = vi.fn();
    expect(await readStoredCodexAuth(dir, read)).toEqual(auth);
    expect(read).not.toHaveBeenCalled();
  });

  it('uses the configured keyring even when a stale file remains', async () => {
    const dir = await home('cli_auth_credentials_store = "keyring"\nauth_keyring_backend = "direct"');
    await writeFile(join(dir, 'auth.json'), '{"OPENAI_API_KEY":"stale"}');
    const read = vi.fn(async () => JSON.stringify(auth));
    expect(await resolveVoiceAuth({ env: { CODEX_HOME: dir }, readKeyring: read })).toEqual({ type: 'apiKey', apiKey: 'synthetic-key' });
    expect(read).toHaveBeenCalledWith(dir);
  });

  it.each([null, '{invalid', '[]', 'null', 'throw'])('auto falls back to a file when keyring returns %s', async (raw) => {
    const dir = await home('cli_auth_credentials_store = "auto"');
    await writeFile(join(dir, 'auth.json'), JSON.stringify(auth));
    expect(await readStoredCodexAuth(dir, async () => {
      if (raw === 'throw') throw new Error('locked');
      return raw;
    })).toEqual(auth);
  });

  it('auto prefers keyring and preserves an access failure if there is no file fallback', async () => {
    const dir = await home('cli_auth_credentials_store = "auto"');
    expect(await readStoredCodexAuth(dir, async () => JSON.stringify(auth))).toEqual(auth);
    await expect(readStoredCodexAuth(dir, async () => { throw new Error('locked'); })).rejects.toThrow('locked');
  });

  it.each(['keyring', 'ephemeral'])('%s never uses a stale credential file', async (mode) => {
    const dir = await home(`cli_auth_credentials_store = "${mode}"`);
    await writeFile(join(dir, 'auth.json'), JSON.stringify(auth));
    await expect(readStoredCodexAuth(dir, async () => null)).rejects.toMatchObject({ code: 'codex_auth_missing' });
  });

  it.each(['invalid = [', 'cli_auth_credentials_store = "invalid"'])('rejects invalid config without echoing it', async (config) => {
    const dir = await home(config);
    await expect(readStoredCodexAuth(dir)).rejects.toMatchObject({ code: 'codex_auth_invalid' });
  });

  it('delegates the configured backend to Codex and allows an explicit environment fallback', async () => {
    const dir = await home('cli_auth_credentials_store = "keyring"\nauth_keyring_backend = "secrets"');
    const read = vi.fn(async () => JSON.stringify(auth));
    expect(await readStoredCodexAuth(dir, read)).toEqual(auth);
    expect(read).toHaveBeenCalledWith(dir);
    expect(await resolveVoiceAuth({ env: { CODEX_HOME: dir, OPENAI_API_KEY: 'synthetic-env' },
      readKeyring: async () => { throw new HostCommandError('codex_keyring_unavailable', 'native failed'); }
    })).toEqual({ type: 'apiKey', apiKey: 'synthetic-env' });
  });

  it('bounds files and rejects unreadable credentials', async () => {
    const dir = await home();
    await writeFile(join(dir, 'auth.json'), 'x'.repeat(256 * 1024 + 1));
    await expect(readStoredCodexAuth(dir)).rejects.toMatchObject({ code: 'codex_auth_invalid' });
    await rm(join(dir, 'auth.json'));
    await mkdir(join(dir, 'auth.json'));
    await expect(readStoredCodexAuth(dir)).rejects.toMatchObject({ code: 'codex_auth_invalid' });
  });
});

describe('native Codex credential reads', () => {
  const fixture = fileURLToPath(new URL('../../../e2e/fixtures/codex-auth.cjs', import.meta.url));
  const spawnImpl: typeof spawnPortableProcess = (request) => spawnPortableProcess({
    ...request, command: process.execPath, args: [fixture, ...request.args]
  });

  it('coalesces canonical homes, then rereads credentials so account changes take effect', async () => {
    const dir = await home();
    await writeFile(join(dir, 'mode'), 'success');
    const alias = join(dir, 'alias');
    await symlink(dir, alias);
    const results = await Promise.all([readCodexKeyring(alias, { spawnImpl }), readCodexKeyring(dir, { spawnImpl })]);
    expect(results[0]).toBe(results[1]);
    expect(JSON.parse(results[0]!)).toEqual({ auth_mode: 'apikey', OPENAI_API_KEY: 'synthetic-e2e-key' });
    expect((await readFile(join(dir, 'calls.ndjson'), 'utf8')).trim().split('\n')).toHaveLength(1);
    await writeFile(join(dir, 'mode'), 'missing');
    expect(await readCodexKeyring(dir, { spawnImpl })).toBeNull();
  });

  it('bounds concurrent helpers and releases every slot after failure', async () => {
    const homes = await Promise.all(Array.from({ length: 5 }, () => home()));
    await Promise.all(homes.map((dir) => writeFile(join(dir, 'mode'), 'timeout')));
    const spawn = vi.fn(spawnImpl);
    const reads = homes.slice(0, 4).map((dir) => readCodexKeyring(dir, { spawnImpl: spawn, timeoutMs: 1_000 }).catch(() => null));
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(4));
    await expect(readCodexKeyring(homes[4]!, { spawnImpl })).rejects.toThrow('busy');
    await Promise.all(reads);
    await writeFile(join(homes[4]!, 'mode'), 'success');
    expect(await readCodexKeyring(homes[4]!, { spawnImpl })).toContain('synthetic-e2e-key');
  });
});
