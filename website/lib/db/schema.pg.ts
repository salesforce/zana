/**
 * Postgres drizzle schema for the extension marketplace registry — the SIX
 * tables in `docs/extension-marketplace-registry-design.md` §3.
 *
 * Kept STRUCTURALLY IDENTICAL to `schema.sqlite.ts` (same table/column names,
 * same portable subset) so the two `drizzle-kit generate` outputs never drift:
 *   - `text`    for ids/strings
 *   - `integer` for flags/counters AND for epoch-millis timestamps (never
 *     `timestamptz`/`timestamp` — timestamps are plain integers the app
 *     computes with `Date.now()`)
 *   - `bytea` (via `customType`, pg-core has no first-class bytea helper) for
 *     the archive bytes (sqlite's twin is `blob({ mode: 'buffer' })`)
 *
 * `releases` has a COMPOSITE PRIMARY KEY `(extension_id, version)` — one row
 * per published version of an extension id.
 */
import { pgTable, text, integer, primaryKey, customType } from 'drizzle-orm/pg-core';

/** `bytea` column mapped to/from Node `Buffer`, matching sqlite's `blob({mode:'buffer'})`. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  }
});

export const users = pgTable('users', {
  id: text('id').primaryKey(), // internal uuid
  githubId: integer('github_id').notNull().unique(), // GitHub numeric id (stable identity)
  githubLogin: text('github_login').notNull(), // publisher handle (display + attribution)
  avatarUrl: text('avatar_url'),
  createdAt: integer('created_at').notNull() // epoch millis
});

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(), // random 32B, base64url; cookie value is HMAC(id)
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull()
});

export const publishTokens = pgTable('publish_tokens', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name'), // human label
  tokenHash: text('token_hash').notNull(), // sha256 hex of the shown-once "zpat_…"
  prefix: text('prefix').notNull(), // first 8 chars, for the list UI (not secret)
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
  revokedAt: integer('revoked_at')
});

export const extensions = pgTable('extensions', {
  id: text('id').primaryKey(), // the extension id (matches manifest id)
  ownerUserId: text('owner_user_id').notNull(),
  createdAt: integer('created_at').notNull()
});

export const releases = pgTable(
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
    archiveBytes: bytea('archive_bytes').notNull(), // EXACT {files:{…}} bytes hashed+signed
    archiveSize: integer('archive_size').notNull(),
    publishedBy: text('published_by').notNull(),
    createdAt: integer('created_at').notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.extensionId, table.version] })
  })
);

// --- Shared row types (same shape as schema.sqlite.ts) ---
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
