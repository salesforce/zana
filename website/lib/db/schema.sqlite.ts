/**
 * SQLite drizzle schema for the extension marketplace registry — the SIX
 * tables in `docs/extension-marketplace-registry-design.md` §3.
 *
 * PORTABLE COLUMN SUBSET ONLY (kept structurally identical to `schema.pg.ts`
 * so `drizzle-kit generate` doesn't drift between dialects):
 *   - `text`    for ids/strings
 *   - `integer` for flags/counters AND for epoch-millis timestamps (never
 *     SQLite's `datetime`/`CURRENT_TIMESTAMP` — timestamps are plain integers
 *     the app computes with `Date.now()`)
 *   - `blob({ mode: 'buffer' })` for the archive bytes (pg's twin is `bytea`
 *     via a `customType`, see `schema.pg.ts`)
 *
 * `releases` has a COMPOSITE PRIMARY KEY `(extension_id, version)` — one row
 * per published version of an extension id.
 */
import { sqliteTable, text, integer, blob, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), // internal uuid
  githubId: integer('github_id').notNull().unique(), // GitHub numeric id (stable identity)
  githubLogin: text('github_login').notNull(), // publisher handle (display + attribution)
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull() // epoch millis
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // random 32B, base64url; cookie value is HMAC(id)
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull()
});

export const publishTokens = sqliteTable('publish_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name'), // human label
  tokenHash: text('token_hash').notNull(), // sha256 hex of the shown-once "zpat_…"
  prefix: text('prefix').notNull(), // first 8 chars, for the list UI (not secret)
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
  revokedAt: integer('revoked_at')
});

export const extensions = sqliteTable('extensions', {
  id: text('id').primaryKey(), // the extension id (matches manifest id)
  ownerUserId: text('owner_user_id').notNull(),
  createdAt: integer('created_at').notNull()
});

export const releases = sqliteTable(
  'releases',
  {
    extensionId: text('extension_id').notNull(),
    version: text('version').notNull(), // SemVer; ordered via compareVersions semantics
    zccApi: text('zcc_api').notNull(), // engines.zccApi range
    sha256: text('sha256').notNull(), // lowercase hex over archive_bytes
    signature: text('signature').notNull(), // base64 Ed25519 over archive_bytes
    permissions: text('permissions'), // JSON array of ExtensionPermission
    title: text('title'),
    description: text('description'),
    author: text('author'), // stamped from users.github_login at publish
    icon: text('icon'),
    archiveBytes: blob('archive_bytes', { mode: 'buffer' }).notNull(), // EXACT {files:{…}} bytes hashed+signed
    archiveSize: integer('archive_size').notNull(),
    publishedBy: text('published_by').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.extensionId, table.version] })
  })
);

// --- Shared row types (also re-exported from schema.pg.ts with the same shape) ---
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type PublishToken = typeof publishTokens.$inferSelect;
export type NewPublishToken = typeof publishTokens.$inferInsert;
export type Extension = typeof extensions.$inferSelect;
export type NewExtension = typeof extensions.$inferInsert;
export type Release = typeof releases.$inferSelect;
export type NewRelease = typeof releases.$inferInsert;
