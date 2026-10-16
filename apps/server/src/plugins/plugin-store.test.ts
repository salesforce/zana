import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyInstalledToolPolicy,
  createPluginStore,
  pluginStorePath,
  type InstalledPluginRow
} from './plugin-store.js';

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function row(over: Partial<InstalledPluginRow> = {}): InstalledPluginRow {
  return {
    id: 'policy-plugin',
    version: '1.0.0',
    name: 'Policy',
    description: 'policy plugin',
    icon: 'Puzzle',
    enabled: true,
    status: 'disabled',
    statusDetail: null,
    provenance: 'direct',
    sourceKind: 'path',
    source: 'path:/tmp/policy',
    rootDir: '/tmp/policy',
    serverEntry: './server.ts',
    appEntry: null,
    npmResolvedVersion: null,
    npmIntegrity: null,
    gitResolvedCommit: null,
    catalogMarketplace: null,
    catalogEntryId: null,
    installedAt: 1,
    updatedAt: 1,
    ...over
  };
}

describe('plugin store strict inventory', () => {
  it('treats a bootstrap missing file as valid empty', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-store-'));
    roots.push(dataDir);
    const store = createPluginStore({ file: pluginStorePath(dataDir) });
    expect(store.readStrict()).toEqual({
      status: 'valid-empty',
      file: { version: 1, plugins: [] }
    });
    expect(store.list()).toEqual([]);
  });

  it('loads a valid registry', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-store-'));
    roots.push(dataDir);
    const store = createPluginStore({ file: pluginStorePath(dataDir) });
    await store.upsert(row({ toolPolicy: 'true' }));
    expect(store.readStrict()).toMatchObject({
      status: 'loaded',
      file: { version: 1, plugins: [expect.objectContaining({ id: 'policy-plugin', toolPolicy: 'true' })] }
    });
  });

  it('reports a known existing registry that later disappears', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-store-'));
    roots.push(dataDir);
    const file = pluginStorePath(dataDir);
    const store = createPluginStore({ file });
    await store.upsert(row());
    unlinkSync(file);
    expect(store.readStrict()).toEqual({
      status: 'missing-known',
      error: 'plugin registry missing after it existed'
    });
    expect(store.list()).toEqual([]);
  });

  it('reports a corrupt registry without rewriting or deleting it', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-store-'));
    roots.push(dataDir);
    const file = pluginStorePath(dataDir);
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    writeFileSync(file, '{not-json');
    const store = createPluginStore({ file });
    const result = store.readStrict();
    expect(result.status).toBe('corrupt');
    expect(store.list()).toEqual([]);
    expect(readFileSync(file, 'utf8')).toBe('{not-json');
  });

  it('reports a wrong-shape registry as corrupt', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-plugin-store-'));
    roots.push(dataDir);
    const file = pluginStorePath(dataDir);
    mkdirSync(join(dataDir, 'plugins'), { recursive: true });
    writeFileSync(file, JSON.stringify({ version: 2, plugins: [] }));
    const store = createPluginStore({ file });
    expect(store.readStrict().status).toBe('corrupt');
  });
});

describe('classifyInstalledToolPolicy', () => {
  it('classifies legacy enabled server rows without a marker as unknown', () => {
    expect(
      classifyInstalledToolPolicy({
        enabled: true,
        serverEntry: './server.ts'
      })
    ).toBe('unknown');
  });

  it('classifies no-server rows as false', () => {
    expect(
      classifyInstalledToolPolicy({
        enabled: true,
        serverEntry: null
      })
    ).toBe('false');
  });

  it('does not let omitted or false demote an enabled known true', () => {
    expect(
      classifyInstalledToolPolicy({
        enabled: true,
        serverEntry: './server.ts',
        toolPolicy: 'true',
        declared: false
      })
    ).toBe('true');
  });
});
