/**
 * drizzle-kit config — generates migration SQL for BOTH dialects from the two
 * structurally-identical schema files (`lib/db/schema.sqlite.ts` /
 * `lib/db/schema.pg.ts`), writing into separate per-dialect folders so
 * `website/lib/db/migrate.mjs` can apply the right one at runtime:
 *   - `drizzle/sqlite/` ← `lib/db/schema.sqlite.ts`
 *   - `drizzle/pg/`     ← `lib/db/schema.pg.ts`
 *
 * drizzle-kit's `Config` only ever describes ONE dialect at a time, so this
 * file switches on `DRIZZLE_DIALECT` (default `sqlite`) — see the
 * `db:generate:{sqlite,pg}` / `db:generate` (both) scripts in `package.json`.
 */
import { defineConfig } from 'drizzle-kit';

const dialect = process.env.DRIZZLE_DIALECT === 'pg' ? 'pg' : 'sqlite';

export default dialect === 'pg'
  ? defineConfig({
      dialect: 'postgresql',
      schema: './lib/db/schema.pg.ts',
      out: './drizzle/pg',
      // Only used by drizzle-kit for introspection-style commands (generate
      // doesn't connect); a placeholder keeps `generate` runnable with no
      // live Postgres instance in CI/local dev.
      dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://placeholder/placeholder' }
    })
  : defineConfig({
      dialect: 'sqlite',
      schema: './lib/db/schema.sqlite.ts',
      out: './drizzle/sqlite',
      dbCredentials: { url: './dev.db' }
    });
