import { describe, expect, it } from 'vitest';
import {
  normalizePluginDatabaseBackupOptions,
  PLUGIN_DATABASE_BACKUP_DEFAULT_MAX_BYTES,
  PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES,
  PluginDatabaseBackupError
} from './database-backup.js';

describe('normalizePluginDatabaseBackupOptions', () => {
  it('accepts one-segment names and applies the default ceiling', () => {
    expect(normalizePluginDatabaseBackupOptions({ name: 'dd-2026.10_12' })).toEqual({ name: 'dd-2026.10_12', maxBytes: PLUGIN_DATABASE_BACKUP_DEFAULT_MAX_BYTES });
    expect(normalizePluginDatabaseBackupOptions({ name: 'a', maxBytes: PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES })).toEqual({ name: 'a', maxBytes: PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES });
  });

  it.each([undefined, null, 'x', { name: '../x' }, { name: '.x' }, { name: 'a/b' }, { name: 'a\\b' }, { name: 'a..b' }, { name: 'x'.repeat(97) },
    { name: 'a', maxBytes: 0 }, { name: 'a', maxBytes: '1' }, { name: 'a', maxBytes: PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES + 1 }])('rejects %j', (input) => {
    expect(() => normalizePluginDatabaseBackupOptions(input)).toThrow(PluginDatabaseBackupError);
  });

  it('names abort errors AbortError so generic abort handling recognises them', () => {
    expect(new PluginDatabaseBackupError('aborted', 'x').name).toBe('AbortError');
    expect(new PluginDatabaseBackupError('failed', 'x')).toMatchObject({ name: 'PluginDatabaseBackupError', code: 'failed' });
  });
});
