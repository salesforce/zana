import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPluginService } from './plugin-service.js';

const locks = vi.hoisted(() => ({ path: '', code: 'EPERM' as string | undefined, removals: [] as Array<{ path: string; options: unknown }> }));
vi.mock('node:fs', async original => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, rmSync: (path: string, options: Parameters<typeof fs.rmSync>[1]) => {
    if (locks.path && String(path).startsWith(locks.path)) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return fs.rmSync(path, options);
  } };
});
vi.mock('node:fs/promises', async original => {
  const fs = await original<typeof import('node:fs/promises')>();
  return { ...fs, rm: async (path: string, options: Parameters<typeof fs.rm>[1]) => {
    if (locks.path && String(path).startsWith(locks.path)) {
      locks.removals.push({ path: String(path), options });
      throw Object.assign(new Error('locked'), { code: locks.code });
    }
    return fs.rm(path, options);
  } };
});

let root: string;
let service: ReturnType<typeof createPluginService>;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'plugin-cleanup-')); locks.path = ''; locks.code = 'EPERM'; locks.removals = [];
  vi.stubEnv('ZCC_OFFICIAL_MARKETPLACE_URL', 'off'); vi.stubEnv('ZCC_INTERNAL_MARKETPLACE_SOURCE', 'off');
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  service?.stop(); locks.path = ''; rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});

it.each(['EPERM', 'EBUSY', 'ENOTEMPTY', undefined])('preserves the original clone failure when generation cleanup fails with %s', async code => {
  locks.code = code;
  const failure = new Error('Git could not materialize the selected commit');
  service = createPluginService({ dataDir: root, bundledRoot: join(root, 'bundled'), cloneGit: async (_url, dest) => {
    mkdirSync(dest, { recursive: true }); locks.path = join(dest, '..'); throw failure;
  } });
  await expect(service.install('git:https://example.test/repo')).rejects.toBe(failure);
  expect(locks.removals).toEqual([{ path: locks.path, options: { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } }]);
  expect(console.warn).toHaveBeenCalled();
});

it('preserves manifest diagnostics and retries orphan cleanup on the next service startup', async () => {
  service = createPluginService({ dataDir: root, bundledRoot: join(root, 'bundled'), cloneGit: async (_url, dest) => {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'package.json'), JSON.stringify({ private: true }));
    locks.path = join(dest, '..'); return { commit: 'a'.repeat(40) };
  } });
  await expect(service.install('git:https://example.test/repo')).rejects.toThrow('no package.json zcc block');
  expect(existsSync(locks.path)).toBe(true);
  service.stop(); locks.path = '';
  service = createPluginService({ dataDir: root, bundledRoot: join(root, 'bundled') });
  await service.start();
  expect(readdirSync(join(root, 'plugins/generations'))).toEqual([]);
});

it('does not block healthy plugin management when startup pruning encounters a locked orphan', async () => {
  const orphan = join(root, 'plugins/generations', randomUUID()); mkdirSync(orphan, { recursive: true }); locks.path = orphan;
  service = createPluginService({ dataDir: root, bundledRoot: join(root, 'bundled'), cloneGit: async (_url, dest) => {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: 'zcc-plugin-fixture', version: '1.0.0',
      zcc: { name: 'Fixture', description: 'Fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    writeFileSync(join(dest, 'server.mjs'), 'export default () => {};');
    return { commit: 'a'.repeat(40) };
  } });
  await service.install('git:https://example.test/repo', { enable: false });
  await service.enable('fixture');
  expect(service.get('fixture')).toMatchObject({ enabled: true, status: 'running' });
  expect(locks.removals[0]?.options).toMatchObject({ maxRetries: 5, retryDelay: 100 });
  expect(console.warn).toHaveBeenCalled();
});

it('preserves promotion validation errors when the rejected candidate is locked', async () => {
  service = createPluginService({ dataDir: root, bundledRoot: join(root, 'bundled'), hostVersion: '2.5.0', cloneGit: async (_url, dest) => {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: 'zcc-plugin-fixture', version: '1.0.0', engines: { zcc: '>=999.0.0' },
      zcc: { name: 'Fixture', description: 'Fixture', branding: { icon: 'Puzzle' }, server: './server.mjs' } }));
    locks.path = join(dest, '..'); return { commit: 'a'.repeat(40) };
  } });
  await expect(service.install('git:https://example.test/repo')).rejects.toThrow(/999\.0\.0/);
  expect(service.get('fixture')).toBeUndefined();
  expect(locks.removals).toHaveLength(1);
});
