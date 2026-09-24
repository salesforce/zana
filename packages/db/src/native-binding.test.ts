import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { sqliteAbiCachePath, sqliteNativeBinding } from './native-binding.mjs';
import { createSqliteDatabase } from './sqlite.js';

describe('runtime SQLite binding', () => {
  const fakeRequire = (paths: string[] | null) => Object.assign(() => ({ version: '12.11.1' }), {
    resolve: { paths: () => paths }
  }) as unknown as NodeRequire;

  it('selects this runtime ABI and dependency version from module ancestry', () => {
    const examined: string[] = [];
    const result = sqliteNativeBinding(fakeRequire(['/repo/packages/db/node_modules', '/repo/node_modules']), (path) => {
      examined.push(path);
      return path.startsWith('/repo/node_modules/');
    }, { platform: 'linux', arch: 'x64', versions: { modules: '148' } as NodeJS.ProcessVersions });
    expect(examined).toHaveLength(2);
    expect(result).toBe('/repo/node_modules/.cache/zcc-native-abi/better-sqlite3/12.11.1/linux-x64/abi-148.node');
  });

  it('falls back to the packaged addon when no matching cache exists', () => {
    expect(sqliteNativeBinding(fakeRequire(['/app/node_modules']), () => false)).toBeUndefined();
    expect(sqliteNativeBinding(fakeRequire(null), () => true)).toBeUndefined();
  });

  it('shares the producer layout and never consults cwd or a renderer-supplied path', () => {
    expect(sqliteAbiCachePath('137', { cacheRoot: '/cache', packageVersion: '12.0.0' }))
      .toBe(`/cache/better-sqlite3/12.0.0/${process.platform}-${process.arch}/abi-137.node`);
    const require = createRequire(import.meta.url);
    const binding = sqliteNativeBinding(require);
    if (binding) expect(binding).toContain(`abi-${process.versions.modules}.node`);
    const db = createSqliteDatabase(':memory:');
    try {
      expect(db.prepare('SELECT 42 AS value').get()).toEqual({ value: 42 });
    } finally { db.close(); }
  });

  it('preserves connection options and propagates real database errors', () => {
    const db = createSqliteDatabase(':memory:', { timeout: 123 });
    try {
      expect(db.pragma('busy_timeout', { simple: true })).toBe(123);
    } finally { db.close(); }
    expect(() => createSqliteDatabase(':memory:', { readonly: true })).toThrow('readonly');
  });
});
