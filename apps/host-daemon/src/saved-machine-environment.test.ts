import { mkdtemp, readFile, writeFile, rm, stat, symlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { SavedMachineEnvironment } from './saved-machine-environment.js';
import { MachineEnvironment } from './machine-environment.js';
import { HOST_ENVIRONMENT_MAX_ENTRIES } from '@zana-ai/zcc-contracts/host-rpc';
let root: string;
let target: NodeJS.ProcessEnv;
let store: SavedMachineEnvironment;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'zcc-saved-env-')); target = {}; store = new SavedMachineEnvironment(root, target); });
afterEach(async () => { store.clear(); await rm(root, { recursive: true, force: true }); });
const save = (name: string, value: string | null) => store.save({ name, value, expectedRevision: store.status().revision });

it('does no disk or environment writes for an unconfigured machine', async () => {
  expect(() => store.status()).toThrow(/could not be loaded/);
  await expect(store.save({ name: 'KEY', value: 'x', expectedRevision: 'none' })).rejects.toThrow();
  await store.initialize(); await store.initialize();
  expect(store.revision).toBeUndefined(); expect(store.status().variables).toEqual([]);
  expect(await readdir(root)).toEqual([]); expect(target).toEqual({});
});
it('encrypts values, exposes names only, persists owner-only files and reloads on restart', async () => {
  await store.initialize(); const result = await save('EXAMPLE_API_KEY', 'fixture-key-value');
  expect(result.variables).toEqual([{ name: 'EXAMPLE_API_KEY', overriddenByEnvironment: false }]);
  expect(JSON.stringify(result)).not.toContain('fixture-key-value');
  expect(target.EXAMPLE_API_KEY).toBe('fixture-key-value'); expect(store.revision).toBe(result.revision);
  expect(await readFile(join(root, 'machine-environment.enc'), 'utf8')).not.toContain('fixture-key-value');
  if (process.platform !== 'win32') for (const name of ['machine-environment.enc', 'machine-environment.key']) expect((await stat(join(root, name))).mode & 0o777).toBe(0o600);
  store.clear(); expect(target).toEqual({});
  store = new SavedMachineEnvironment(root, target); await store.initialize();
  expect(target.EXAMPLE_API_KEY).toBe('fixture-key-value'); expect(store.status()).toEqual(result);
  const successor = { ...target }; successor.EXAMPLE_API_KEY = 'stale-value-from-old-process';
  const restarted = new SavedMachineEnvironment(root, successor); await restarted.initialize();
  expect(successor.EXAMPLE_API_KEY).toBe('fixture-key-value'); restarted.clear();
});
it('preserves existing gateway URLs, tokens, helpers and externally replaced values', async () => {
  Object.assign(target, { ANTHROPIC_BASE_URL: 'https://gateway.example', ANTHROPIC_AUTH_TOKEN: 'host-owned', ANTHROPIC_API_KEY: 'ambient-key', OTHER: '' });
  await store.initialize(); await save('ANTHROPIC_API_KEY', 'saved-key'); await save('OTHER', 'value');
  expect(target.ANTHROPIC_API_KEY).toBe('ambient-key'); expect(target.ANTHROPIC_AUTH_TOKEN).toBe('host-owned'); expect(target.ANTHROPIC_BASE_URL).toBe('https://gateway.example');
  expect(store.status().variables[0]).toMatchObject({ overriddenByEnvironment: true });
  await save('OTHER', 'rotated'); expect(target.OTHER).toBe('rotated');
  target.OTHER = 'external-change'; await save('OTHER', null); expect(target.OTHER).toBe('external-change');
  await save('ANTHROPIC_API_KEY', null); expect(target.ANTHROPIC_API_KEY).toBe('ambient-key');
  const third = new SavedMachineEnvironment(root, {}); await third.initialize(); expect(third.status().variables).toEqual([]); third.clear();
});
it('removes only saved values and invalidates new launches even when removing the last key', async () => {
  await store.initialize(); await save('KEY', 'a'); const revision = store.revision;
  await save('KEY', null); expect(target.KEY).toBeUndefined(); expect(target.ZCC_SAVED_ENV_NAMES).toBeUndefined();
  expect(store.revision).toBeTruthy(); expect(store.revision).not.toBe(revision);
});
it('serializes changes and refuses stale revisions without replacing the winner', async () => {
  await store.initialize(); const expectedRevision = store.status().revision;
  const results = await Promise.allSettled(['A', 'B'].map(name => store.save({ name, value: 'x', expectedRevision })));
  expect(results.map(row => row.status).sort()).toEqual(['fulfilled', 'rejected']);
  expect((results.find(row => row.status === 'rejected') as PromiseRejectedResult).reason.code).toBe('environment_conflict');
  expect(store.status().variables).toHaveLength(1);
});
it.each([
  { name: 'PATH', value: 'bad' }, { name: 'ZCC_SERVER_URL', value: 'bad' }, { name: 'lowercase', value: 'bad' },
  { name: 'KEY', value: 'bad\0value' }, { name: 'KEY', value: 'x'.repeat(8193) },
  { name: 'GIT_CONFIG_KEY_0', value: 'core.sshCommand' }, { name: 'KEY', value: 'x', cwd: '/escape' },
])('rejects untrusted settings before any persistence (%j)', async (input) => {
  await store.initialize(); await expect(store.save({ ...input, expectedRevision: store.status().revision } as never)).rejects.toMatchObject({ code: 'invalid_environment' });
  expect(await readdir(root)).toEqual([]); expect(target).toEqual({});
});
it.each(['invalid-json', 'symlink', 'oversize'])('fails closed on %s storage without changing ambient auth', async (kind) => {
  target.EXISTING_KEY = 'host-owned'; const path = join(root, 'machine-environment.enc');
  if (kind === 'symlink') { await writeFile(join(root, 'other'), '{}'); await symlink(join(root, 'other'), path); }
  else await writeFile(path, kind === 'oversize' ? 'x'.repeat(2 * 1024 * 1024 + 1) : 'bad');
  await expect(store.initialize()).rejects.toMatchObject({ code: 'environment_unavailable' });
  expect(target.EXISTING_KEY).toBe('host-owned'); expect(() => store.status()).toThrow();
});
it.each(['missing-key', 'invalid-key', 'tampered', 'duplicate'])('never regenerates or silently discards an unreadable saved key (%s)', async (kind) => {
  await store.initialize(); await save('KEY', 'fixture-sensitive-key'); store.clear();
  const path = join(root, 'machine-environment.enc'); const original = await readFile(path, 'utf8');
  if (kind === 'missing-key') await rm(join(root, 'machine-environment.key'));
  else if (kind === 'invalid-key') await writeFile(join(root, 'machine-environment.key'), 'bad');
  else { const disk = JSON.parse(original); if (kind === 'duplicate') disk.variables.push(disk.variables[0]); else disk.variables[0].name = 'DIFFERENT_NAME'; await writeFile(path, JSON.stringify(disk)); }
  store = new SavedMachineEnvironment(root, target);
  await expect(store.initialize()).rejects.toMatchObject({ code: 'environment_unavailable' });
  expect(target.KEY).toBeUndefined();
  if (kind === 'missing-key') await expect(stat(join(root, 'machine-environment.key'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('enforces the retention bound while permitting replacements at capacity', async () => {
  await store.initialize();
  for (let index = 0; index < HOST_ENVIRONMENT_MAX_ENTRIES; index++) await save(`KEY_${index}`, 'x');
  await expect(save('ONE_TOO_MANY', 'x')).rejects.toMatchObject({ code: 'environment_limit' });
  await save('KEY_0', 'replacement'); expect(target.KEY_0).toBe('replacement');
  expect((await readdir(root)).filter(name => name.endsWith('.tmp'))).toEqual([]);
});
it('bounds the encrypted UTF-8 payload before committing or applying it', async () => {
  await store.initialize();
  let reached = false;
  for (let index = 0; index < HOST_ENVIRONMENT_MAX_ENTRIES; index++) {
    try { await save(`UNICODE_KEY_${index}`, '😀'.repeat(4000)); }
    catch (error) {
      expect(error).toMatchObject({ code: 'environment_limit' });
      expect(target[`UNICODE_KEY_${index}`]).toBeUndefined(); reached = true; break;
    }
  }
  expect(reached).toBe(true); expect((await stat(join(root, 'machine-environment.enc'))).size).toBeLessThanOrEqual(2 * 1024 * 1024);
});

it('keeps server-forwarded gateway groups above saved values across restart and restores the fallback when removed', async () => {
  await store.initialize(); await save('EXAMPLE_API_KEY', 'personal-key');
  store.clear();
  store = new SavedMachineEnvironment(root, target); await store.initialize();
  const forwarded = new MachineEnvironment(target);
  const entries = [
    { name: 'EXAMPLE_API_KEY', value: 'gateway-key', group: 'gateway' },
    { name: 'EXAMPLE_BASE_URL', value: 'https://gateway.example', group: 'gateway' },
  ];
  const result = store.withHigherPriorityEnvironment(() => forwarded.replace(entries));
  expect(result.applied).toEqual(['EXAMPLE_API_KEY', 'EXAMPLE_BASE_URL']);
  expect(target.EXAMPLE_API_KEY).toBe('gateway-key'); expect(target.EXAMPLE_BASE_URL).toBe('https://gateway.example');
  expect(store.status().variables[0]?.overriddenByEnvironment).toBe(true);
  await save('EXAMPLE_API_KEY', 'rotated-personal-key');
  expect(target.EXAMPLE_API_KEY).toBe('gateway-key');
  store.withHigherPriorityEnvironment(() => forwarded.replace([]));
  expect(target.EXAMPLE_API_KEY).toBe('rotated-personal-key'); expect(target.EXAMPLE_BASE_URL).toBeUndefined();
  expect(() => store.withHigherPriorityEnvironment(() => { throw new Error('fixture'); })).toThrow('fixture');
  expect(target.EXAMPLE_API_KEY).toBe('rotated-personal-key');
  store.clear();
  expect(store.withHigherPriorityEnvironment(() => 'unconfigured')).toBe('unconfigured');
  expect(target.EXAMPLE_API_KEY).toBeUndefined();
});
