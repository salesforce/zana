import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeCodexVoiceStatus } from './codex-voice-status.js';

function codexHome(opts: { config?: string; auth?: string } = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'voice-status-'));
  const dir = join(home, '.codex');
  mkdirSync(dir, { recursive: true });
  if (opts.config !== undefined) writeFileSync(join(dir, 'config.toml'), opts.config);
  if (opts.auth !== undefined) writeFileSync(join(dir, 'auth.json'), opts.auth);
  return home;
}

const probe = (homeDir: string, env: NodeJS.ProcessEnv = {}) => probeCodexVoiceStatus({ homeDir, env });

describe('probeCodexVoiceStatus', () => {
  it('is ready when the host has OPENAI_API_KEY, even with no Codex login', async () => {
    expect(await probe(codexHome(), { OPENAI_API_KEY: ' sk-x ' })).toEqual({ state: 'ready' });
  });

  it('ignores a blank OPENAI_API_KEY', async () => {
    expect(await probe(codexHome(), { OPENAI_API_KEY: '  ' })).toEqual({ state: 'missing' });
  });

  it('file mode: ready with auth.json, missing without or when invalid', async () => {
    expect(await probe(codexHome({ auth: '{"auth_mode":"chatgpt"}' }))).toEqual({ state: 'ready' });
    expect(await probe(codexHome())).toEqual({ state: 'missing' });
    expect(await probe(codexHome({ auth: 'not json' }))).toEqual({ state: 'missing' });
  });

  it('auto mode: ready with auth.json, otherwise unverified (may be in the keyring)', async () => {
    const config = 'cli_auth_credentials_store = "auto"\n';
    expect(await probe(codexHome({ config, auth: '{}' }))).toEqual({ state: 'ready' });
    expect(await probe(codexHome({ config }))).toEqual({ state: 'unverified' });
  });

  it('keyring mode is unverified and never reads auth.json state', async () => {
    const config = 'cli_auth_credentials_store = "keyring"\n';
    expect(await probe(codexHome({ config }))).toEqual({ state: 'unverified' });
  });

  it('ephemeral mode and invalid config are missing', async () => {
    expect(await probe(codexHome({ config: 'cli_auth_credentials_store = "ephemeral"\n', auth: '{}' }))).toEqual({ state: 'missing' });
    expect(await probe(codexHome({ config: 'cli_auth_credentials_store = "bogus"\n' }))).toEqual({ state: 'missing' });
    expect(await probe(codexHome({ config: '= broken toml' }))).toEqual({ state: 'missing' });
  });
});
