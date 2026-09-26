import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCodexKeyring, readStoredCodexAuth } from './codex-auth-storage.js';
import { resolveVoiceAuth } from './codex-auth.js';

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

  it('rejects unsupported backends and allows an explicit environment fallback', async () => {
    const dir = await home('cli_auth_credentials_store = "keyring"\nauth_keyring_backend = "secrets"');
    const read = vi.fn();
    await expect(readStoredCodexAuth(dir, read)).rejects.toMatchObject({ code: 'codex_keyring_unavailable' });
    expect(read).not.toHaveBeenCalled();
    expect(await resolveVoiceAuth({ env: { CODEX_HOME: dir, OPENAI_API_KEY: 'synthetic-env' } })).toEqual({ type: 'apiKey', apiKey: 'synthetic-env' });
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

describe('macOS Codex Keychain access', () => {
  function runner(error: Record<string, unknown> | null = null, stdout = JSON.stringify(auth)) {
    return vi.fn((_file, _args, _options, cb) => {
      queueMicrotask(() => cb(error, stdout, 'synthetic-secret-stderr'));
    }) as unknown as ReturnType<typeof vi.fn<typeof execFile>>;
  }

  it('targets only Codex’s entry for the canonical home with bounded capture', async () => {
    const dir = await home();
    const alias = join(dir, 'alias');
    await symlink(dir, alias);
    const run = runner();
    const [first, second] = await Promise.all([
      readCodexKeyring(alias, { platform: 'darwin', execFileImpl: run }),
      readCodexKeyring(alias, { platform: 'darwin', execFileImpl: run })
    ]);
    expect(first).toBe(JSON.stringify(auth));
    expect(second).toBe(first);
    expect(run).toHaveBeenCalledWith('/usr/bin/security', [
      'find-generic-password', '-s', 'Codex Auth', '-a',
      `cli|${createHash('sha256').update(await realpath(dir)).digest('hex').slice(0, 16)}`, '-w'
    ], expect.objectContaining({ timeout: 8000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL', cwd: await realpath(dir) }), expect.any(Function));
  });

  it.each([null, { code: 44 }])('treats empty/missing entries as missing: %j', async (error) => {
    expect(await readCodexKeyring(await home(), { platform: 'darwin', execFileImpl: runner(error, ' \n') })).toBeNull();
  });

  it.each([{ code: 1 }, { killed: true }, { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, { code: 'ENOENT' }])('sanitizes process failure %j and releases its slot', async (error) => {
    const dir = await home();
    await expect(readCodexKeyring(dir, { platform: 'darwin', execFileImpl: runner({ ...error, message: 'synthetic-secret' }) })).rejects.toMatchObject({
      code: 'codex_keyring_unavailable', message: expect.not.stringContaining('synthetic-secret')
    });
    expect(await readCodexKeyring(dir, { platform: 'darwin', execFileImpl: runner() })).toBe(JSON.stringify(auth));
  });

  it('does not run macOS tools on other platforms', async () => {
    const run = runner();
    await expect(readCodexKeyring(await home(), { platform: 'linux', execFileImpl: run })).rejects.toMatchObject({ code: 'codex_keyring_unavailable' });
    expect(run).not.toHaveBeenCalled();
  });
});
