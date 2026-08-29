import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultPrMonitorDataDir, migrateLegacyKv } from '../lib/migrate.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-prm-migrate-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function memoryKv(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    store,
    async get<T>(key: string) {
      return store.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return [...store.keys()];
    }
  };
}

describe('migrateLegacyKv', () => {
  it('resolves the data dir from ZCC_DATA_DIR then ZCC_CENTER_DIR', () => {
    const prevData = process.env.ZCC_DATA_DIR;
    const prevCenter = process.env.ZCC_CENTER_DIR;
    try {
      process.env.ZCC_DATA_DIR = '/tmp/zcc-data';
      expect(defaultPrMonitorDataDir()).toBe('/tmp/zcc-data');
      delete process.env.ZCC_DATA_DIR;
      process.env.ZCC_CENTER_DIR = '/tmp/zcc-center';
      expect(defaultPrMonitorDataDir()).toBe('/tmp/zcc-center');
      delete process.env.ZCC_CENTER_DIR;
      expect(defaultPrMonitorDataDir()).toMatch(/\.zcc$/);
    } finally {
      if (prevData === undefined) delete process.env.ZCC_DATA_DIR;
      else process.env.ZCC_DATA_DIR = prevData;
      if (prevCenter === undefined) delete process.env.ZCC_CENTER_DIR;
      else process.env.ZCC_CENTER_DIR = prevCenter;
    }
  });
  it('copies the disk-extension modules file when plugin KV is empty', async () => {
    const dataDir = tempDir();
    mkdirSync(join(dataDir, 'modules'), { recursive: true });
    writeFileSync(
      join(dataDir, 'modules', 'pr-monitor.json'),
      JSON.stringify({
        prs: { 'https://github.com/acme/app/pull/1': { url: 'https://github.com/acme/app/pull/1' } },
        settings: { badgeMode: 'unread' },
        dismissedUrls: {},
        syncHealth: { disconnectedHosts: [] }
      })
    );
    const kv = memoryKv();
    expect(await migrateLegacyKv(kv, dataDir)).toBe(true);
    expect(await kv.get('settings')).toEqual({ badgeMode: 'unread' });
    expect(Object.keys((await kv.get('prs')) as object)).toHaveLength(1);
  });

  it('does not overwrite a non-empty plugin store', async () => {
    const dataDir = tempDir();
    mkdirSync(join(dataDir, 'modules'), { recursive: true });
    writeFileSync(join(dataDir, 'modules', 'pr-monitor.json'), JSON.stringify({ settings: { badgeMode: 'unread' } }));
    const kv = memoryKv({ settings: { badgeMode: 'total' } });
    expect(await migrateLegacyKv(kv, dataDir)).toBe(false);
    expect(await kv.get('settings')).toEqual({ badgeMode: 'total' });
  });

  it('returns false when the modules file is missing or malformed', async () => {
    const dataDir = tempDir();
    const kv = memoryKv();
    expect(await migrateLegacyKv(kv, dataDir)).toBe(false);
    mkdirSync(join(dataDir, 'modules'), { recursive: true });
    writeFileSync(join(dataDir, 'modules', 'pr-monitor.json'), '{not json');
    expect(await migrateLegacyKv(kv, dataDir)).toBe(false);
    writeFileSync(join(dataDir, 'modules', 'pr-monitor.json'), '{}');
    expect(await migrateLegacyKv(kv, dataDir)).toBe(false);
    writeFileSync(join(dataDir, 'modules', 'pr-monitor.json'), '[]');
    expect(await migrateLegacyKv(kv, dataDir)).toBe(false);
  });
});
