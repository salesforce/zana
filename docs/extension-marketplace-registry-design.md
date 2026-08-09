# Extension Marketplace Registry — Backend Design

**Status:** Design for `feat/extension-marketplace-registry`.
**Scope:** Turn the existing static `website/` into an authenticated publish backend
that serves the SAME `index.json` + archive feed the UNCHANGED desktop client
(`src/main/extension-registry.ts`) already installs from.

## 0. The non-negotiable seam (read this first)

The desktop client is FROZEN. The backend's only correctness obligation is that
what it serves round-trips through the existing engine unchanged:

- `fetchRegistryIndex()` requires HTTPS, caps the body at **1 MiB**
  (`INDEX_MAX_BYTES`), and rejects anything where `parsed.schema !== 1 ||
  !Array.isArray(parsed.releases)`. → **The served index MUST be
  `{ schema: 1, releases: RegistryRelease[] }` and MUST stay under 1 MiB (so it
  carries metadata only — never archive bytes).**
- `applyRelease()` downloads `release.url` (HTTPS, capped at **16 MiB**
  `ARCHIVE_MAX_BYTES`), then gates:
  - `sha256Hex(bytes) === release.sha256.toLowerCase()` — lowercase hex of the
    RAW archive bytes.
  - Ed25519: `makeEd25519Verifier` calls `crypto.verify(null, data, publicKey,
    Buffer.from(signatureB64,'base64'))`. → **The server signs with
    `crypto.sign(null, bytes, privateKey)` (PEM pkcs8) → base64.** Identical to
    what `scripts/publish-extension.mjs` already does with `--key`.
  - `decodeArchive()` parses `{ files: { "<name>": "<base64>" } }`, rejects names
    containing `/ \ ..` or a leading `.`, and requires `extension.json`.
- `pickBestRelease()` picks the highest `compareVersions` release per `id` whose
  `zccApi` satisfies `checkApiCompat`. The index may carry MULTIPLE versions per
  id — never-downgrade + permission-widening consent all live client-side.

**Rule:** sha256 and signature are computed over the exact byte string the server
will later stream back. Store the archive as an opaque BLOB and serve it verbatim
— never re-serialize JSON between hashing and serving, or the digest breaks.

`website/lib/registry.ts::fetchCatalog` (used by the marketing site) fetches with
`cache: 'no-store'` and the same `schema === 1` guard — so the same endpoint feeds
both the app and the website browse view.

## 1. Architecture

```
 publisher (browser)                      CLI / app (non-interactive)
      │  GitHub OAuth (web flow)                │  Bearer zpat_… (publish token)
      ▼                                         ▼
 ┌──────────────────────────────────────────────────────────────┐
 │  website/ (Next.js App Router, Node runtime — NOT export)     │
 │                                                                │
 │  app/api/auth/github/{login,callback}  → session cookie       │
 │  app/api/tokens                         → mint/list/revoke PAT │
 │  app/api/extensions/[id]/releases (POST)→ validate→sign→store  │
 │                                                                │
 │  app/extensions/index.json           (public, from DB)        │
 │  app/extensions/archives/[file]      (public, BLOB verbatim)  │
 │                                                                │
 │  app/(marketing) page,features,docs,marketplace  = STATIC SSG │
 └───────────────┬──────────────────────────────┬───────────────┘
                 │ drizzle-orm                    │ Ed25519 sign
                 ▼                                ▼
        SQLite (local) / Postgres (prod)   REGISTRY_SIGNING_KEY (pkcs8 PEM env)
                 │
                 ▼ served feed
        GET index.json / GET archive  ── HTTPS ──▶ src/main/extension-registry.ts
                                                    (sha256 + Ed25519 verify, UNCHANGED)
```

## 2. The `output: 'export'` problem → recommended fix

`website/next.config.mjs` sets `output: 'export'`, which emits a fully static
`out/` served by the zero-dep `website/server.mjs`. **Static export disables
route handlers entirely** — there is no server runtime to run
`app/api/**/route.ts`. This is all-or-nothing per Next app.

**Recommendation: drop `output: 'export'` and run the Next app in
`output: 'standalone'` under `next start`, keeping every marketing/docs page
statically pre-rendered.**

Why this and not the alternatives:

- Next's App Router is already hybrid: pages default to SSG and are baked at
  build time; only `app/api/**` + the two feed routes opt into dynamic
  (`export const dynamic = 'force-static'` stays on marketing/docs, `force-dynamic`
  on API/feed). So marketing/docs remain byte-static and CDN-cacheable — we lose
  nothing there — while API routes gain a runtime. **One app, one deploy artifact.**
- The `standalone` output produces a self-contained `server.js`; the Dockerfile's
  runtime stage runs `node server.js` (Next's own server) instead of the custom
  `server.mjs`. The existing IP-gate logic in `server.mjs` moves into Next
  `middleware.ts` (same X-Forwarded-For last-hop rule, same `ALLOWED_CIDRS`).
- Rejected: a **separate** API service — violates the locked decision ("extend
  the existing `website/`") and doubles deploy/CORS surface.
- Rejected: keeping `export` + a sidecar. Same objection, plus two runtimes.

Cost of the switch: `heroku.yml` `run:` and the Dockerfile CMD change from
`node server.mjs` to `node server.js` (standalone). `NEXT_PUBLIC_*` build-arg
inlining is unchanged. This is the single riskiest, most cross-cutting change —
it is Phase 0 and everything else depends on it.

## 3. Data layer

**Library: `drizzle-orm` + `drizzle-kit`.** One-line justifications:

- `drizzle-orm` — first-class `better-sqlite3` AND `node-postgres` drivers behind
  a typed schema; `better-sqlite3` is already a root dependency.
- `drizzle-kit` — generates SQL migrations per dialect (`generate:sqlite`,
  `generate:pg`) so the same schema ships to both.
- `pg` — Postgres driver (prod only).
- `zod` — request-body validation for the publish/token APIs (small, ubiquitous).
- OAuth code-exchange, session HMAC, publish-token hashing, and Ed25519 signing
  are **hand-rolled on `node:crypto`** — zero new deps, matching the repo's
  no-extra-deps habit (the engine already proves `crypto.sign/verify(null,…)`).

Dialect is selected at runtime from `DATABASE_URL`: absent or `file:…` →
`better-sqlite3`; `postgres://…` → `pg`. To keep the two generated schemas
near-identical, use only a **portable column subset**: `text` ids/strings,
`integer` flags, **epoch-millis `integer` timestamps** (never dialect-specific
`timestamptz`/`datetime`), archive bytes as `blob`(sqlite)/`bytea`(pg).

### Tables

```
users
  id            text PK            -- internal uuid
  github_id     integer UNIQUE      -- GitHub numeric id (stable identity)
  github_login  text NOT NULL       -- publisher handle (display + attribution)
  avatar_url    text
  created_at    integer NOT NULL

sessions                            -- web login (httpOnly cookie → row)
  id            text PK            -- random 32B, base64url; the cookie value is HMAC(id)
  user_id       text NOT NULL FK users(id)
  created_at    integer NOT NULL
  expires_at    integer NOT NULL

publish_tokens                      -- non-interactive CLI/app auth (PAT)
  id            text PK
  user_id       text NOT NULL FK users(id)
  name          text                -- human label
  token_hash    text NOT NULL       -- sha256 hex of the shown-once "zpat_…"
  prefix        text NOT NULL       -- first 8 chars, for the list UI (not secret)
  created_at    integer NOT NULL
  last_used_at  integer
  revoked_at    integer

extensions                          -- one row per claimed id (ownership anchor)
  id            text PK            -- the extension id (matches manifest id)
  owner_user_id text NOT NULL FK users(id)
  created_at    integer NOT NULL

releases                            -- one row per (extension_id, version)
  extension_id  text NOT NULL FK extensions(id)
  version       text NOT NULL       -- SemVer; ordered via compareVersions semantics
  zcc_api       text NOT NULL       -- engines.zccApi range
  sha256        text NOT NULL       -- lowercase hex over archive_bytes
  signature     text NOT NULL       -- base64 Ed25519 over archive_bytes
  permissions   text                -- JSON array of ExtensionPermission
  title         text
  description   text
  author        text                -- stamped from users.github_login at publish
  icon          text
  archive_bytes blob NOT NULL       -- the EXACT { files:{…} } bytes hashed+signed
  archive_size  integer NOT NULL
  published_by  text NOT NULL FK users(id)
  created_at    integer NOT NULL
  PRIMARY KEY (extension_id, version)
```

Migration strategy: `drizzle-kit generate` writes numbered SQL files under
`website/drizzle/{sqlite,pg}/`. A tiny `website/lib/db/migrate.ts` runs the
dialect's folder on boot (local) / on release (prod). CI/local E2E use the SQLite
folder; prod runs the PG folder. Because columns stay in the portable subset the
two folders differ only in `AUTOINCREMENT`/`bytea`/PK syntax that drizzle-kit
emits automatically.

## 4. GitHub OAuth (web flow) + non-interactive CLI auth

Env vars (add to `website/.env.example`):
```
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_OAUTH_CALLBACK=http://localhost:4321/api/auth/github/callback
SESSION_SECRET=            # HMAC key for the session cookie
DATABASE_URL=              # unset/file:./dev.db → sqlite ; postgres://… → pg
REGISTRY_SIGNING_KEY=      # Ed25519 private key, pkcs8 PEM (server signs releases)
REGISTRY_PUBLIC_KEY=       # spki PEM (published so the app can pin it)
PUBLIC_BASE_URL=http://localhost:4321   # used to build release.url
GITHUB_OAUTH_MODE=         # "mock" in tests → inject fake GitHub responses
```

Web flow (all in `app/api/auth/github/`):
1. `GET /api/auth/github/login` → set a short-lived `oauth_state` cookie
   (random, httpOnly), 302 to
   `https://github.com/login/oauth/authorize?client_id&scope=read:user&state`.
2. `GET /api/auth/github/callback?code&state` → verify `state` matches the cookie,
   POST `https://github.com/login/oauth/access_token` (JSON accept) to exchange
   `code`, GET `https://api.github.com/user`, upsert `users` by `github_id`,
   insert a `sessions` row, set `Set-Cookie: zcc_session=<HMAC(sessionId)>;
   HttpOnly; Secure; SameSite=Lax; Path=/`, 302 to the publisher dashboard.
3. `POST /api/auth/logout` → delete session row, clear cookie.

**Testability seam (mirrors the engine's injected `fetchBytes`):** put the two
GitHub HTTP calls behind `website/lib/github.ts` (`exchangeCode`, `fetchUser`) so
the E2E harness injects a fake and never touches github.com. Gate the fake behind
`GITHUB_OAUTH_MODE=mock` — prod code path is unchanged.

CLI / app non-interactive auth: **minted publish tokens.** After web login, the
dashboard `POST /api/tokens` mints a `zpat_<random>` shown ONCE; the server stores
only `sha256(token)` in `publish_tokens.token_hash`. The CLI/app send
`Authorization: Bearer zpat_…`; the API hashes and looks it up, rejects
revoked/expired, stamps `last_used_at`. Device flow is a documented future
alternative but out of scope for this run.

## 5. Publish API contract

All publish routes require `Authorization: Bearer zpat_…`. Bodies validated with zod.

### `POST /api/extensions/:id/releases`
Request (JSON):
```jsonc
{
  "archive": { "files": { "extension.json": "<base64>", "main.mjs": "<base64>" } }
  // OR "archiveBase64": "<base64 of the full {files:…} JSON>" for CLI parity
}
```
Server-side pipeline (fail-closed, in order):
1. **Auth** → resolve token → `user`.
2. **Archive shape** → re-run the EXACT `decodeArchive` rules (reject `/ \ ..`,
   leading `.`, require `extension.json`); enforce total bytes ≤ 16 MiB
   (`ARCHIVE_MAX_BYTES`); the canonical bytes = `Buffer.from(JSON.stringify({files}))`
   built the SAME way as `publish-extension.mjs::buildArchive` (or the raw
   `archiveBase64` if sent — hash whatever will be stored).
3. **Manifest** → parse `extension.json`; require string `id`, string `version`,
   string `engines.zccApi`; assert `manifest.id === :id` (route ↔ archive match).
4. **Ownership** → if `extensions` has no row for `:id`, INSERT one owned by
   `user` (**first publish claims the id**). Else require
   `extensions.owner_user_id === user.id` → else `403 not_owner`.
5. **Monotonicity** → require `compareVersions(version, maxExistingVersion) > 0`
   (never-downgrade / no re-publish of an existing version) → else `409 stale_version`.
6. **Sign + hash** → `sha256 = createHash('sha256').update(bytes).digest('hex')`;
   `signature = crypto.sign(null, bytes, createPrivateKey(REGISTRY_SIGNING_KEY))`
   `.toString('base64')`.
7. **Store** → INSERT `releases` row with `archive_bytes = bytes`, catalog
   metadata from the manifest, `author = user.github_login`, `published_by`.
8. Response `201`:
```jsonc
{ "id":"…","version":"…","zccApi":"…",
  "url":"<PUBLIC_BASE_URL>/extensions/archives/<id>-<version>.json",
  "sha256":"…","signature":"…","permissions":[…],
  "title":"…","description":"…","author":"…","icon":"…" }   // === RegistryRelease
```

Error shape: `{ "error": "<code>", "message": "…" }` with codes
`unauthorized|not_owner|stale_version|bad_archive|bad_manifest|too_large`.

### Token management
- `POST /api/tokens {name}` (session) → `201 { token:"zpat_…" }` (shown once).
- `GET /api/tokens` (session) → list `{id,name,prefix,created_at,last_used_at}`.
- `DELETE /api/tokens/:id` (session) → set `revoked_at`.

## 6. Served-feed contract (public, no auth)

### `GET /extensions/index.json`
Project the DB to the client shape, byte-for-byte compatible with
`fetchRegistryIndex` + `fetchCatalog`:
```ts
{ schema: 1,
  releases: rows.map(r => ({
    id: r.extension_id, version: r.version, zccApi: r.zcc_api,
    url: `${PUBLIC_BASE_URL}/extensions/archives/${r.extension_id}-${r.version}.json`,
    sha256: r.sha256, signature: r.signature,
    ...(r.permissions ? { permissions: JSON.parse(r.permissions) } : {}),
    ...(r.title ? { title: r.title } : {}) // …description, …author, …icon
  })) }
```
Emit ALL versions per id (client picks best / enforces never-downgrade). Set
`Cache-Control: public, max-age=0, must-revalidate` and
`Content-Type: application/json`. **Guard: the index must stay < 1 MiB** — since
it holds only metadata (archives are separate), this holds for thousands of
releases; add a size assertion + a paging TODO note.

### `GET /extensions/archives/:file`  (`<id>-<version>.json`)
Look up the `releases` row, stream `archive_bytes` **verbatim** with
`Content-Type: application/json`. These are the exact bytes hashed + signed, so
the client's sha256/Ed25519 gates pass. 404 if absent.

The app is pointed at this via the EXISTING config seam — no client change:
`~/.zcc/extension-registry.json` = `{ "enabled": true, "registryUrl":
"<base>/extensions/index.json", "publicKey": "<REGISTRY_PUBLIC_KEY>",
"requireSignature": true }` (or `ZCC_EXTENSION_REGISTRY_URL`).

## 7. Security

- **Ownership:** first publish of an id claims it; only `owner_user_id`
  republishes (enforced in step 4). No id squatting via a second publisher.
- **Integrity reused, not reinvented:** sha256 + Ed25519 exactly as the engine
  verifies; the private key lives ONLY in `REGISTRY_SIGNING_KEY` (server env),
  the public key is pinned in the app config. A compromised host is *detected*,
  not trusted (same posture as `docs/release-hosting.md`).
- **Tokens:** stored as sha256 hashes, shown once, revocable, `Bearer` only over
  HTTPS. Session cookie is `HttpOnly; Secure; SameSite=Lax` + HMAC-bound.
- **Rate limits:** per-token publish limit (e.g. 30/hour) and per-IP auth limit,
  via an in-DB counter (portable) — deny-by-default on breach.
- **Caps:** archive ≤ 16 MiB (matches `ARCHIVE_MAX_BYTES`), index < 1 MiB,
  reject non-`https` `PUBLIC_BASE_URL` in prod (the app rejects non-HTTPS `url`).
- **CSRF:** publish/token-mutation routes accept Bearer (CLI) or same-site
  session; state param protects the OAuth round-trip.
- **Threat notes:** archive path-escape (blocked by `decodeArchive` rules,
  re-run server-side); zip-bomb N/A (no decompression — plain base64, size-capped);
  metadata XSS is a website-render concern (escape in the browse view), never a
  client concern (the engine ignores catalog fields for install).

## 8. Explicitly OUT of scope for this run

Ratings/reviews, download analytics, moderation/takedown workflow, categories &
search ranking, org/team ownership (single-owner only), key rotation UX, device
flow, multi-region/CDN of the archive BLOBs (served from the app for now),
yank/unpublish, and email. Postgres is *supported* but local E2E runs on SQLite.
