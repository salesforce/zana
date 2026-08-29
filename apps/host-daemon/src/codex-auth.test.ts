import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostCommandError } from './host-command-error.js';
import { readCodexAuthCredentials, resolveVoiceAuth } from './codex-auth.js';

function jwtPayload(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

function writeAuth(homeDir: string, body: unknown): void {
  const dir = join(homeDir, '.codex');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'auth.json'), JSON.stringify(body));
}

describe('codex auth', () => {
  it('reads ChatGPT tokens from ~/.codex/auth.json', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-codex-auth-'));
    const accessToken = jwtPayload({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acct_jwt' },
      email: 'user@example.com'
    });
    writeAuth(homeDir, {
      auth_mode: 'chatgpt',
      tokens: { access_token: accessToken, account_id: 'acct_file' }
    });
    await expect(readCodexAuthCredentials({ homeDir })).resolves.toEqual({
      type: 'chatgpt',
      accessToken,
      accountId: 'acct_file',
      accountEmail: 'user@example.com',
      isFedrampAccount: false
    });
  });

  it('reads an API key from Codex auth', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-codex-key-'));
    writeAuth(homeDir, { auth_mode: 'apikey', OPENAI_API_KEY: 'sk-codex' });
    await expect(readCodexAuthCredentials({ homeDir })).resolves.toEqual({
      type: 'apiKey',
      apiKey: 'sk-codex'
    });
  });

  it('falls back to OPENAI_API_KEY when Codex auth is missing', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-codex-missing-'));
    await expect(readCodexAuthCredentials({ homeDir })).rejects.toBeInstanceOf(HostCommandError);
    await expect(resolveVoiceAuth({
      homeDir,
      env: { OPENAI_API_KEY: 'sk-env' }
    })).resolves.toEqual({ type: 'apiKey', apiKey: 'sk-env' });
  });

  it('rejects malformed JSON', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-codex-bad-'));
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    writeFileSync(join(homeDir, '.codex', 'auth.json'), '{nope');
    await expect(readCodexAuthCredentials({ homeDir })).rejects.toMatchObject({
      code: 'codex_auth_invalid'
    });
  });

  it('reads account id, email, and fedramp flags from JWT claims', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-codex-jwt-'));
    const accessToken = jwtPayload({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_jwt',
        chatgpt_account_is_fedramp: true
      },
      'https://api.openai.com/profile': { email: 'profile@example.com' }
    });
    writeAuth(homeDir, {
      auth_mode: 'chatgpt',
      tokens: { access_token: accessToken }
    });
    await expect(readCodexAuthCredentials({ homeDir })).resolves.toMatchObject({
      type: 'chatgpt',
      accountId: 'acct_jwt',
      accountEmail: 'profile@example.com',
      isFedrampAccount: true
    });
  });

  it('uses CODEX_HOME and rejects an API-key file without a key', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-codex-home-'));
    const codexHome = join(homeDir, 'custom-codex');
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({ auth_mode: 'apikey' }));
    await expect(readCodexAuthCredentials({
      homeDir,
      env: { CODEX_HOME: codexHome }
    })).rejects.toMatchObject({ code: 'codex_auth_invalid' });
    await expect(resolveVoiceAuth({
      homeDir,
      env: { CODEX_HOME: codexHome, OPENAI_API_KEY: 'sk-fallback' }
    })).resolves.toEqual({ type: 'apiKey', apiKey: 'sk-fallback' });
  });
});
