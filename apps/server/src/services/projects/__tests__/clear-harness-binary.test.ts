import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ home: '' }));
h.home = mkdtempSync(join(tmpdir(), 'zcc-clear-binary-'));
vi.mock('electron', () => ({ app: { getPath: () => h.home } }));

const { store } = await import('../store.js');

function configPath(): string {
  const find = (dir: string): string | undefined => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isFile() && entry.name === 'config.json') return full;
      if (entry.isDirectory()) { const hit = find(full); if (hit) return hit; }
    }
    return undefined;
  };
  const hit = find(h.home);
  if (!hit) throw new Error('config.json not written');
  return hit;
}
const onDisk = () => JSON.parse(readFileSync(configPath(), 'utf8'));

describe('clearing a harness binary with an empty string', () => {
  it('unsets claude: old path gone from flat and canonical keys, resolves to claude', () => {
    store.setConfig({ claudeBinary: '/opt/claude' });
    expect(store.getConfig().claudeBinary).toBe('/opt/claude');
    const cleared = store.setConfig({ claudeBinary: '' });
    expect(cleared.claudeBinary).toBe('claude');
    expect(JSON.stringify(onDisk())).not.toContain('/opt/claude');
    expect(store.getConfig().claudeBinary).toBe('claude');
    expect(store.getConfig().harnesses?.byId?.claude?.binary).toBeUndefined();
    store.setConfig({ shell: '/bin/bash' });
    expect(JSON.stringify(onDisk())).not.toContain('/opt/claude');
    expect(store.getConfig().claudeBinary).toBe('claude');
  });

  it.each([
    ['codex', 'codexBinary'],
    ['afcode', 'afcodeBinary']
  ] as const)('unsets %s', (id, key) => {
    store.setConfig({ [key]: '/opt/bin' });
    expect(store.getConfig()[key]).toBe('/opt/bin');
    store.setConfig({ [key]: '' });
    expect(store.getConfig()[key]).toBeUndefined();
    expect(store.getConfig().harnesses?.byId?.[id]?.binary).toBeUndefined();
    store.setConfig({ shell: '/bin/bash' });
    expect(JSON.stringify(onDisk())).not.toContain('/opt/bin');
  });

  it('keeps a non-empty claude binary and an old config without blanks unchanged', () => {
    store.setConfig({ claudeBinary: '  /usr/local/bin/claude ' });
    expect(store.getConfig().claudeBinary).toBe('/usr/local/bin/claude');
    expect(onDisk().harnesses.byId.claude.binary).toBe('/usr/local/bin/claude');
  });

  it('loads a frozen old-format config (flat claudeBinary, no harnesses) and keeps it through a save', () => {
    writeFileSync(configPath(), JSON.stringify({ version: 1, claudeBinary: '/old/claude', shell: '/bin/zsh' }));
    expect(store.getConfig().claudeBinary).toBe('/old/claude');
    store.setConfig({ shell: '/bin/bash' });
    expect(store.getConfig().claudeBinary).toBe('/old/claude');
    expect(JSON.stringify(onDisk())).toContain('/old/claude');
  });

  it('resolves a blank claudeBinary on disk (the standalone server can write one) to the default', () => {
    writeFileSync(configPath(), JSON.stringify({ version: 1, claudeBinary: '' }));
    expect(store.getConfig().claudeBinary).toBe('claude');
    expect(store.snapshotConfig().config.claudeBinary).toBe('claude');
  });

  it('resolves a blank claudeBinary passed to replaceConfig to the default', () => {
    const { config, hash } = store.snapshotConfig();
    expect(store.replaceConfig({ ...config, claudeBinary: '' }, hash).claudeBinary).toBe('claude');
    expect(store.getConfig().claudeBinary).toBe('claude');
  });
});
