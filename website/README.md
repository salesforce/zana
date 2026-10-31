# Zana Command Center — website

The public face of the app: **marketing landing**, **plugin marketplace**,
**docs**, and **download**.

**Live:** [https://zana-ide.com/](https://zana-ide.com/). Heroku app: `zcc`.

Built with Next.js (App Router) in standalone-server
mode so the site can serve its authenticated publishing API and plugin feed
routes alongside static marketing and documentation pages.

## Run

```bash
cd website
npm install
npm run dev          # http://localhost:4321
npm run build        # production standalone build in .next/
```

## How it connects to the app (no duplication)

| Page | Source of truth |
| --- | --- |
| `/` landing | Curated copy in `app/page.tsx` (mirrors repo `README.md`) |
| `/marketplace` | Same-origin `GET /marketplace/v1/marketplace.json` — official first-party plugin pointers (`schemaVersion: 1`). Generated from repo `plugins/*/package.json`. |
| `/marketplace/v1/marketplace.json` | Public catalog for `zcc marketplace add` (CORS `*`). Alias: `/plugins/index.json`. |
| `/docs/*` | Rendered at build time from allowlisted `docs/*.md` via `scripts/sync-docs.mjs` (internal audits, architecture notes, and the root README are NOT published) |
| `/extensions` | In-app Plugin Guide `ProductMap` synced from `plugins/plugin-guide/` via `scripts/sync-plugin-guide.mjs` |
| `/extensions/sdk` | SDK overview — four layers and a link to the Plugin Guide map |
| `/download` | Server-side GitHub latest-release lookup (cached 10 min) for direct macOS `.dmg` and Windows `.exe` links; falls back to GitHub Releases |

## Configure

Copy `.env.example` → `.env.local` and fill in the feed URLs once the CDN base
exists. All endpoints are env-driven so the same build points at any
environment without code changes — the same posture as the app.

## Deploy

The Dockerfile builds Next standalone **and** runs the front door
(`node relay/front-door.mjs`). Next listens on container loopback; the front
door binds `0.0.0.0:$PORT`, routes Zana Connect laptop hosts, and answers the
retired machine-relay paths (`/_zcc/relay`, `/t/<id>`, `/install.sh`,
`/install/*`, `/internal/hosts/*`, `/internal/plugins/*`) with `410` so they
never reach Next. Machines pair through Zana Connect or an SSH tunnel. Official
desktop releases inline the public origin (`ZCC_APP_URL`) at `electron-vite
build` time — set the GitHub secret `ZCC_APP_URL` (never commit it). Local
`pnpm run release:mac` still reads that env var but does not publish.

`NEXT_PUBLIC_*` values are inlined at **build time**, so pass feed URLs as Docker
build arguments rather than runtime environment variables. Set `PUBLIC_BASE_URL`
in production so canonical URLs, `robots.txt`, and the sitemap use the real HTTPS
origin.

Website analytics is optional: set `NEXT_PUBLIC_GA_MEASUREMENT_ID` to the GA4
web stream's `G-…` ID at build time (Docker `--build-arg`). Visitors can accept,
decline, or revisit their choice through **Analytics cookies**. Public pages send
`page_view` and the download links send `download_click` with their platform; account/pairing
and publishing pages are excluded, and URL queries/fragments are removed.
Disable enhanced measurement on this stream because page views and download
clicks are sent explicitly; automatic history/form events can include private
account URLs. Advertising signals are disabled and cookies stay on this hostname.

Verify with the focused `analytics.test.ts` / `GoogleAnalytics.test.tsx` tests
from the repository root. Against a production build containing a measurement
ID, run `ANALYTICS_TEST_BASE_URL=http://127.0.0.1:4321 node scripts/verify-analytics.mjs`
from `website/`. The browser verification intercepts Google's script and sends
no real analytics events.

Build and run locally:

```bash
cd website
docker build --build-arg PUBLIC_BASE_URL=http://localhost:4321 -t zcc-web .
docker run --rm -p 4321:4321 -e PORT=4321 \
  -e PUBLIC_BASE_URL=https://zcc-7808c5bc8f3d.herokuapp.com zcc-web
curl -sI http://127.0.0.1:4321/ | head -n1          # Next
curl -sI http://127.0.0.1:4321/install.sh | head -n1 # 410 (retired relay path), not 308
```

To publish to Heroku app `zcc`:

```bash
cd website
heroku container:login
# Preserve the existing PUBLIC_BASE_URL and Connect runtime values.
# Docker 29+ defaults to OCI media types that Heroku's registry rejects
# (`error from registry: unsupported`). Force Docker schema 2 + gzip:
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --build-arg PUBLIC_BASE_URL=https://zana-ide.com \
  --build-arg NEXT_PUBLIC_GA_MEASUREMENT_ID=G-WFXR8G1EP8 \
  --output 'type=image,name=registry.heroku.com/zcc/web:latest,push=true,oci-mediatypes=false,compression=gzip,force-compression=true' .
heroku container:release web -a zcc
```

`heroku.yml` lives under `website/` — push from that directory. The `web`
process must stay `node relay/front-door.mjs`, not `node server.js`. The live
Heroku hostname is `https://zcc-7808c5bc8f3d.herokuapp.com` (not
`zcc.herokuapp.com`); the website's canonical origin remains `https://zana-ide.com`.

### Connect relay modules in this Docker app

Zana Connect's tunnel runtime (`server.mjs`, `protocol.mjs`, `machine-routes.mjs`,
`preview-policy.mjs`) is canonical in `services/mobile-relay`. Run
`node website/scripts/sync-mobile-relay.mjs` after editing them (also a `predev`
/ `prebuild` hook). The checked-in snapshot under `website/relay/mobile` permits
the website-only Docker build context; `relay/mobile/snapshot.test.ts` verifies
identical source. Next's tracing does not include the front door, so the
Dockerfile explicitly includes its `ws` runtime.

The older phone relay (`MOBILE_RELAY_TOKEN`, `MOBILE_RELAY_PUBLIC_URL`) and the
shared-token machine relay (`ZCC_RELAY_TOKEN`) are removed. Once this image is
deployed, unset those Heroku Config Vars.

## Adding a doc

Edit the `DOCS` allowlist in `scripts/sync-docs.mjs`, then run
`npm run sync-docs` (also a `predev` / `prebuild` hook). Only listed files are
published; this is deliberate so internal `docs/*` (audits, plans, reviews)
stay private. `lib/docs.ts` reads the generated `content/docs/_manifest.json`.

## Agent City demo

The homepage reuses the Agent City plugin's canvas renderer and visibility-aware
animation loop. `node scripts/sync-agent-city.mjs` refreshes the committed
`lib/agent-city/` snapshot from plugin sources. It strips TypeScript types with
Node 22's built-in type stripper, so the website has no plugin SDK dependency.
The `predev`/`prebuild` hooks refresh it in a full checkout; website-only Docker
builds keep the snapshot. Edit the original plugin artwork, then sync; do not
hand-edit the generated files. The demo's public fixtures and accessible controls
live in `app/components/AgentCityDemo.tsx` and `agent-city-demo-data.ts`.

To verify a running build, navigate a Browser Automation session's `main` page
to its origin, then run `scripts/verify-homepage.browser.js` with
`zcc browser-automation run <session> --script-file "$PWD/website/scripts/verify-homepage.browser.js" --script-host <host-id>`
from the repository root. It checks the rendered canvas, interiors, keyboard
return, motion preferences, 320–1280px layouts, and the deeper-page destinations.

## Plugin Guide map

The in-app Plugin Guide (`plugins/plugin-guide/src`) is the source of truth.
`scripts/sync-plugin-guide.mjs` copies `ProductMap` sources and `plugin-guide.css`
into `lib/plugin-guide/` for `/extensions`. Edit the plugin sources, then
run `npm run sync-plugin-guide` (also a `predev` / `prebuild` hook). Do not
hand-edit `lib/plugin-guide/`. The copy drops `.js` from relative imports so
Next can resolve the TypeScript files. `plugins/plugin-guide/src/api-sync.test.ts`
fails if the synced files or `docs/extensions-sdk-reference.md` drift.

## Official plugin marketplace

`scripts/generate-marketplace.mjs` writes `content/marketplace/marketplace.json`
from the repo `plugins/` tree (git pointers with `subdir: plugins/<id>`). The
image bundles that copy, but `/marketplace/v1/marketplace.json` serves the
catalog from `main` on GitHub (`lib/live-marketplace.ts`, 5-minute cache,
last-good and bundled fallbacks), so merged listings go live without a
redeploy. `MARKETPLACE_UPSTREAM_URL` overrides the source; `off` serves only the
bundled copy. Desktop apps seed that
HTTPS URL automatically (override with `ZCC_OFFICIAL_MARKETPLACE_URL`; `off`
skips the seed). The seed is fail-soft if the feed is unreachable.

### Shared mobile accounts (Zana Connect)

Set `CONNECT_DOMAIN` to enable per-account laptop enrollment, phone pairing and
server discovery in this same Docker app. It requires persistent Postgres, the
website GitHub OAuth credentials, a stable session secret, and wildcard DNS/TLS
for the laptop namespace. Keep one always-on web dyno. See
[the Connect deployment and verification guide](../docs/mobile-connect.md).
Account-based internet access, including personal browser addresses, is
covered by `e2e/phone-connect-account.spec.ts`.
Leaving `CONNECT_DOMAIN` empty serves only the website.

Set `CONNECT_BROWSER_DOMAIN=zana-ide.com` to offer personal addresses such as
`your-name.zana-ide.com`. Add the matching `*.zana-ide.com` Heroku domain, DNS
and TLS certificate. Keep `CONNECT_DOMAIN=connect.zana-ide.com` and its wildcard
in place so existing desktop tunnels and paired phones retain their URLs. The
root website and reserved hosts such as `www`, `api`, `docs` and `connect` remain
outside the personal-address router. Without `CONNECT_BROWSER_DOMAIN`, browser
addresses retain the original `CONNECT_DOMAIN` namespace.
