import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DISABLED_CLAUDE_BINARY, dropInheritedKeychainEnv, isolatedClaudePath, isolatedKeychainEnv, writeAppConfig } from '../e2e/fixtures/app-config.js';

const homes: string[] = [];
function home() {
  const path = mkdtempSync(join(tmpdir(), 'zcc-config-isolation-'));
  homes.push(path);
  return path;
}
const read = (path: string) => JSON.parse(readFileSync(join(path, '.zcc/config.json'), 'utf8'));
afterEach(() => { for (const path of homes.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('E2E Claude isolation', () => {
  it('intercepts bare CLI health checks before a real executable on PATH', () => {
    const path = home();
    const marker = join(path, 'real-cli-called');
    writeFileSync(join(path, 'claude'), `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    const result = spawnSync('claude', ['doctor'], {
      env: { ...process.env, PATH: isolatedClaudePath(`${path}:${process.env.PATH}`) }, encoding: 'utf8',
    });
    expect(result.status).toBe(78);
    expect(result.stderr).toContain('Real Claude is disabled in deterministic E2E tests');
    expect(() => readFileSync(marker)).toThrow();
  });

  it('handles missing PATH and preserves live-test CLI discovery', () => {
    expect(isolatedClaudePath(undefined)).toBe(join(DISABLED_CLAUDE_BINARY, '..'));
    expect(isolatedClaudePath('/explicit/path', true)).toBe('/explicit/path');
    expect(isolatedClaudePath(undefined, true)).toBeUndefined();
  });

  it('blocks real Claude in a fresh UI test home', () => {
    const path = home();
    writeAppConfig(path, { sponsorPromptDismissed: true });
    expect(read(path)).toEqual({ walkthroughCompleted: true, setupDismissed: true, sponsorPromptDismissed: true, claudeBinary: DISABLED_CLAUDE_BINARY });
    const result = spawnSync(DISABLED_CLAUDE_BINARY, ['--print', '--model', 'haiku', '--', 'Name this test'], { env: { ...process.env, HOME: path }, encoding: 'utf8' });
    expect(result.status).toBe(78);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Real Claude is disabled in deterministic E2E tests');
  });

  it('preserves an explicitly supplied fake CLI', () => {
    const path = home();
    writeAppConfig(path, { claudeBinary: '/test/fake-claude' });
    expect(read(path).claudeBinary).toBe('/test/fake-claude');
  });

  it('fills the missing binary in config seeded before launch', () => {
    const path = home();
    mkdirSync(join(path, '.zcc'));
    writeFileSync(join(path, '.zcc/config.json'), JSON.stringify({ theme: 'dark' }));
    writeAppConfig(path, { theme: 'light' });
    expect(read(path)).toEqual({ theme: 'dark', claudeBinary: DISABLED_CLAUDE_BINARY });
  });

  it('retains changed settings and the selected CLI on relaunch', () => {
    const path = home();
    writeAppConfig(path, { claudeBinary: '/test/fake-claude', theme: 'dark' });
    const before = readFileSync(join(path, '.zcc/config.json'), 'utf8');
    writeAppConfig(path, { claudeBinary: '/different', theme: 'light' });
    expect(readFileSync(join(path, '.zcc/config.json'), 'utf8')).toBe(before);
  });

  it('allows explicit live tests to use normal CLI resolution', () => {
    const path = home();
    writeAppConfig(path, {}, true);
    expect(read(path).claudeBinary).toBeUndefined();
    writeAppConfig(path, {}, true);
    expect(read(path).claudeBinary).toBeUndefined();
  });
});

describe('E2E keychain isolation', () => {
  it('keeps Salesforce keys out of the keychain for an isolated home', () => {
    expect(isolatedKeychainEnv(false)).toEqual({ SF_USE_GENERIC_UNIX_KEYCHAIN: 'true' });
  });

  it('leaves a preserved real HOME on its real keychain', () => {
    expect(isolatedKeychainEnv(true)).toEqual({});
  });

  it('drops a parent shell value for a preserved real HOME, unless the spec sets it', () => {
    const inherited = () => ({ HOME: '/real', SF_USE_GENERIC_UNIX_KEYCHAIN: 'true' });
    const preserved = inherited();
    dropInheritedKeychainEnv(preserved, true);
    expect(preserved).toEqual({ HOME: '/real' });
    const explicit = inherited();
    dropInheritedKeychainEnv(explicit, true, { SF_USE_GENERIC_UNIX_KEYCHAIN: 'true' });
    expect(explicit).toEqual(inherited());
    const isolated = inherited();
    dropInheritedKeychainEnv(isolated, false);
    expect(isolated).toEqual(inherited());
  });

  it.runIf(process.platform === 'darwin')('documents that an isolated home has no macOS keychain', () => {
    const result = spawnSync('/usr/bin/security', ['default-keychain'], { env: { ...process.env, HOME: home() }, encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('could not be found');
  });
});
