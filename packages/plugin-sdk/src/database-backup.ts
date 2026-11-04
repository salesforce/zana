/**
 * Shared limits and validation for `zcc.storage.backupDatabase()`.
 *
 * Plugins name a backup; they never choose its directory. The host writes it
 * under the plugin's own data folder (`<dataDir>/plugins/<id>/backups/`).
 */

/** A backup name: one path segment, no leading dot, no separators. */
export const PLUGIN_DATABASE_BACKUP_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
/** Default size ceiling when the plugin passes no `maxBytes`. */
export const PLUGIN_DATABASE_BACKUP_DEFAULT_MAX_BYTES = 256 * 1024 * 1024;
/** Hard ceiling a plugin cannot raise. */
export const PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** The host keeps at most this many finished backup files per plugin; older ones are removed. */
export const PLUGIN_DATABASE_BACKUP_RETENTION = 8;
/**
 * Every backup file carries one row in this host-reserved table. A live
 * database never has it, so a plugin that finds it at startup is running on a
 * restored backup. The plugin must drop it once it has handled the restore.
 */
export const PLUGIN_DATABASE_BACKUP_MARKER_TABLE = '_zcc_backup';

export interface PluginDatabaseBackupOptions {
  /** File stem; the host stores `<name>.db`. Reusing a name replaces that backup atomically. */
  name: string;
  /** Refuse (and remove the partial copy) when the database is larger than this. */
  maxBytes?: number;
  /** Abort removes the partial copy and rejects with an AbortError. */
  signal?: AbortSignal;
}

export interface PluginDatabaseBackup {
  /** Also stored in the copy's `_zcc_backup` marker row. */
  backupId: string;
  name: string;
  /** Absolute path of the finished 0600 file. */
  path: string;
  bytes: number;
  /** Hex SHA-256 of the finished file. */
  sha256: string;
  createdAt: number;
}

export class PluginDatabaseBackupError extends Error {
  constructor(readonly code: 'invalid' | 'too-large' | 'aborted' | 'failed', message: string) {
    super(message);
    this.name = code === 'aborted' ? 'AbortError' : 'PluginDatabaseBackupError';
  }
}

/** Validates plugin input. Returns the effective size ceiling. */
export function normalizePluginDatabaseBackupOptions(options: unknown): { name: string; maxBytes: number } {
  if (!options || typeof options !== 'object') throw new PluginDatabaseBackupError('invalid', 'backup options must be an object');
  const { name, maxBytes } = options as { name?: unknown; maxBytes?: unknown };
  if (typeof name !== 'string' || !PLUGIN_DATABASE_BACKUP_NAME_PATTERN.test(name) || name.includes('..')) {
    throw new PluginDatabaseBackupError('invalid', 'backup name must be 1-96 characters of letters, digits, ".", "_" or "-", starting with a letter or digit');
  }
  if (maxBytes === undefined) return { name, maxBytes: PLUGIN_DATABASE_BACKUP_DEFAULT_MAX_BYTES };
  if (typeof maxBytes !== 'number' || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES) {
    throw new PluginDatabaseBackupError('invalid', `backup maxBytes must be an integer between 1 and ${PLUGIN_DATABASE_BACKUP_HARD_MAX_BYTES}`);
  }
  return { name, maxBytes };
}
