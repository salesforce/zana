import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPluginUninstalledStore, pluginUninstalledPath } from './plugin-uninstalled.js';

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('plugin uninstall tombstone', () => {
  it('persists ids and forgets them on reinstall', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-uninstalled-'));
    roots.push(dataDir);
    const store = createPluginUninstalledStore({ file: pluginUninstalledPath(dataDir) });
    expect(store.has('docs')).toBe(false);
    await store.add('docs');
    expect(store.has('docs')).toBe(true);
    const persisted = JSON.parse(readFileSync(pluginUninstalledPath(dataDir), 'utf8')) as {
      ids: string[];
    };
    expect(persisted.ids).toEqual(['docs']);
    await store.forget('docs');
    expect(store.has('docs')).toBe(false);
  });

  it('ignores invalid plugin ids', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-uninstalled-'));
    roots.push(dataDir);
    const store = createPluginUninstalledStore({ file: pluginUninstalledPath(dataDir) });
    await store.add('../etc');
    expect(store.has('../etc')).toBe(false);
  });
});
