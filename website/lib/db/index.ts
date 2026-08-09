/**
 * Runtime dialect selection for the data layer, driven by `DATABASE_URL`
 * (see `docs/extension-marketplace-registry-design.md` §3/§4):
 *   - unset, or `file:…`            → SQLite (`better-sqlite3` + drizzle sqlite-core)
 *   - `postgres://…` / `postgresql://…` → Postgres (`pg` + drizzle pg-core)
 *
 * `getDb()` lazily builds ONE singleton per process (so route handlers /
 * scripts sharing this module reuse the same connection/handle) and returns
 * both the typed drizzle client and the resolved dialect tag so callers that
 * need dialect-specific behavior (e.g. `migrate.mjs` picking a migrations
 * folder) don't have to re-parse `DATABASE_URL` themselves.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as sqliteSchema from './schema.sqlite.ts';
import * as pgSchema from './schema.pg.ts';

export type Dialect = 'sqlite' | 'pg';

export interface SqliteDb {
  dialect: 'sqlite';
  db: import('drizzle-orm/better-sqlite3').BetterSQLite3Database<typeof sqliteSchema>;
  schema: typeof sqliteSchema;
}

export interface PgDb {
  dialect: 'pg';
  db: import('drizzle-orm/node-postgres').NodePgDatabase<typeof pgSchema>;
  schema: typeof pgSchema;
}

export type AnyDb = SqliteDb | PgDb;

let singleton: AnyDb | undefined;

/** Default local SQLite file, mirroring `DATABASE_URL=file:./dev.db`. */
const DEFAULT_SQLITE_PATH = './dev.db';

/**
 * Resolve a `file:` URL (or bare path) to an absolute filesystem path,
 * relative to `website/` (this module's directory's parent), and make sure
 * its parent directory exists so `better-sqlite3` can create the file.
 */
function resolveSqlitePath(databaseUrl: string | undefined): string {
  const raw = databaseUrl?.trim();
  const spec = !raw ? DEFAULT_SQLITE_PATH : raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
  const absolute = resolve(process.cwd(), spec || DEFAULT_SQLITE_PATH);
  const dir = dirname(absolute);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return absolute;
}

/** Which dialect `DATABASE_URL` selects. Exported so callers (e.g. migrate) can decide without building a client. */
export function resolveDialect(databaseUrl: string | undefined = process.env.DATABASE_URL): Dialect {
  const raw = databaseUrl?.trim();
  if (!raw || raw.startsWith('file:')) return 'sqlite';
  if (/^postgres(ql)?:\/\//i.test(raw)) return 'pg';
  // Any other bare path (no scheme) is treated as a sqlite file path too —
  // matches "unset or file:… → sqlite" from the design (a bare path has no
  // ambiguity with a postgres:// URL).
  return 'sqlite';
}

async function buildDb(): Promise<AnyDb> {
  const databaseUrl = process.env.DATABASE_URL;
  const dialect = resolveDialect(databaseUrl);

  if (dialect === 'pg') {
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: databaseUrl });
    const db = drizzle(pool, { schema: pgSchema });
    return { dialect: 'pg', db, schema: pgSchema };
  }

  const path = resolveSqlitePath(databaseUrl);
  const { default: Database } = await import('better-sqlite3');
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  const db = drizzle(sqlite, { schema: sqliteSchema });
  return { dialect: 'sqlite', db, schema: sqliteSchema };
}

/**
 * Lazily initialize (once per process) and return the singleton drizzle
 * client for whichever dialect `DATABASE_URL` selects. Safe to call
 * repeatedly/concurrently — subsequent calls reuse the same instance.
 */
export async function getDb(): Promise<AnyDb> {
  if (!singleton) singleton = await buildDb();
  return singleton;
}

/** Test-only seam: force a fresh client next `getDb()` call (e.g. between test files with different DATABASE_URLs). */
export function resetDbForTests(): void {
  singleton = undefined;
}
