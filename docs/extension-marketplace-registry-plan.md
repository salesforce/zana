# Extension Marketplace Registry — Build Plan

Phased, dependency-ordered tasks for ~3–4 builder agents in ONE worktree.
Every served byte must remain installable by the UNCHANGED
`src/main/extension-registry.ts` (see the design doc §0).

## Merge-conflict hotspots (SERIALIZE edits to these)
- `website/package.json` — Phases 0,1,2,3 all add deps/scripts. **Phase 0 adds
  ALL deps up front** (`drizzle-orm`, `drizzle-kit`, `pg`, `better-sqlite3`,
  `zod`, `vitest`) so no later phase touches it.
- `website/next.config.mjs`, `website/Dockerfile`, `website/heroku.yml`,
  `website/tsconfig.json` — Phase 0 only.
- `website/middleware.ts` — Phase 0 creates it (IP gate); Phase 2 must not.
- `website/app/components/Nav.tsx` + `website/lib/site.ts` — Phase 6 only (add
  login/dashboard link + `PUBLIC_BASE_URL`); single owner.
- `scripts/publish-extension.mjs` — Phase 5 only.

## Phase 0 — Runtime switch + deps (SEQUENTIAL, blocks everything) — 1 builder
Files: `website/next.config.mjs` (drop `output:'export'`, add
`output:'standalone'`), `website/Dockerfile` + `website/heroku.yml` (CMD →
`node server.js`), `website/middleware.ts` (port `server.mjs` IP-gate),
`website/package.json` (all deps + `db:generate`/`db:migrate`/`test` scripts),
`website/tsconfig.json` (path aliases), `website/.env.example`.
Acceptance: `npm run build` in `website/` produces `.next/standalone`; marketing
+ docs + marketplace pages still render as static; `next start` serves them;
`/api/healthz` route returns 200.

## Phase 1 — Data layer (after 0) — 1 builder
Files: `website/lib/db/schema.{sqlite,pg}.ts`, `website/lib/db/index.ts`
(dialect select on `DATABASE_URL`), `website/lib/db/migrate.ts`,
`website/drizzle.config.ts`, generated `website/drizzle/{sqlite,pg}/*`,
`website/lib/signing.ts` (Ed25519 sign + sha256 — shared by Phases 3,4,6).
Acceptance: `db:migrate` creates all six tables on a temp SQLite; a vitest unit
signs bytes and verifies them with the engine's `makeEd25519Verifier`.

## Phase 2 — GitHub OAuth + sessions + tokens (after 1) — 1 builder
Files: `website/lib/github.ts` (injectable `exchangeCode`/`fetchUser` + mock
mode), `website/lib/auth.ts` (session cookie HMAC, `requireSession`,
`requireToken`), `website/app/api/auth/github/{login,callback}/route.ts`,
`website/app/api/auth/logout/route.ts`, `website/app/api/tokens/route.ts`,
`website/app/api/tokens/[id]/route.ts`.
Acceptance: units for cookie HMAC round-trip, token mint→hash→lookup→revoke;
callback with mocked GitHub creates a user + session.
**Can run in PARALLEL with Phase 4** (feed doesn't need auth).

## Phase 3 — Publish API (after 1 + 2) — 1 builder
Files: `website/lib/publish.ts` (decodeArchive-parity validation, manifest
checks, ownership, `compareVersions` monotonicity), `website/lib/validation.ts`
(zod schemas), `website/app/api/extensions/[id]/releases/route.ts`.
Acceptance: units for each reject path (`bad_archive`, `bad_manifest`,
`not_owner`, `stale_version`, `too_large`) + happy path returning a
`RegistryRelease`; the stored `sha256`/`signature` verify against the bytes.

## Phase 4 — Served feed (after 1; PARALLEL with 2/3) — 1 builder
Files: `website/app/extensions/index.json/route.ts`,
`website/app/extensions/archives/[file]/route.ts`, `website/lib/feed.ts`
(DB rows → `RegistryIndex`).
Acceptance: unit projects seeded rows to `{schema:1,releases:[…]}` that passes
`fetchRegistryIndex`'s guard; archive route streams stored bytes verbatim and a
manually seeded release's bytes match its stored `sha256`.

## Phase 5 — CLI publish-through-API (after 3 + 4) — 1 builder
Files: `scripts/publish-extension.mjs` (add `--api <url> --token <zpat>` mode:
reuse `buildArchive`, POST to `/api/extensions/:id/releases`, print the returned
release; keep the existing local-file mode intact).
Acceptance: against a running local server + a minted token, `--api` publishes a
release that then appears in `GET /extensions/index.json`.

## Phase 6 — Website wiring + E2E happy path (after all) — 1 builder
Files: `website/app/dashboard/page.tsx` (list tokens, mint button — SSR/dynamic),
`website/app/components/Nav.tsx` (+login/dashboard link), `website/lib/site.ts`
(+`publicBaseUrl`), `e2e/marketplace-publish-e2e.spec.ts` (or a node script under
`website/scripts/`), reusing the pattern in `e2e/fixtures/registry.ts`.
E2E happy path (single test):
1. Boot `website/` against a temp SQLite + a generated Ed25519 keypair +
   `GITHUB_OAUTH_MODE=mock`; run migrations.
2. Create a session via the mock OAuth callback; `POST /api/tokens` → `zpat_…`.
3. Run the CLI (`--api … --token …`) to publish the E2E dummy artifact.
4. Assert `GET /extensions/index.json` lists it and the archive's bytes hash to
   the release `sha256`.
5. Point a throwaway `~/.zcc/extension-registry.json` at the local index with the
   generated `publicKey` + `NODE_EXTRA_CA_CERTS`, then reuse the existing
   `MarketplacePage` fixture to Install and assert the row flips to "Installed".
Acceptance: `npm test` (units, both root + website) green; the E2E publishes via
real auth and installs via the unchanged engine.

## Test strategy
- **Vitest units** (add a `website/vitest.config.ts`; root vitest already excludes
  `e2e/**`): signing round-trip vs `makeEd25519Verifier`; cookie/token crypto;
  publish validation reject paths; monotonicity via `compareVersions`; feed
  projection passes `fetchRegistryIndex`'s `schema===1` guard.
- **E2E** = the Phase 6 happy path (login→mint→publish→serve→install), reusing
  `e2e/fixtures/registry.ts` + `e2e/fixtures/marketplace.ts`.
- The GitHub HTTP calls are injected (`website/lib/github.ts` mock mode) so no
  test reaches github.com — mirrors the engine's injected `fetchBytes`.

## Parallelization summary
- 0 → (1) → then {2, 4} in parallel → 3 (needs 1+2) can overlap 4 → 5 (needs 3+4)
  → 6 (needs all). A 4-builder team: one does 0 then 1; while 3 runs, another does
  2, a third does 4, a fourth preps 5/6 scaffolding + E2E fixtures.
