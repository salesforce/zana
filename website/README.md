# Zana Command Center — website

The public face of the app: **marketing landing**, **plugin marketplace**,
**docs**, and **download**. Built with Next.js (App Router) in standalone-server
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
| `/download` | Parses `latest-mac.yml` from `NEXT_PUBLIC_UPDATE_FEED_URL`; links to GitHub Releases |

## Configure

Copy `.env.example` → `.env.local` and fill in the feed URLs once the CDN base
exists. All endpoints are env-driven so the same build points at any
environment without code changes — the same posture as the app.

## Deploy

The Dockerfile builds Next standalone **and** runs the pairing front door
(`node relay/front-door.mjs`). Next listens on container loopback; the front
door binds `0.0.0.0:$PORT`. Pairing paths (`/install.sh`, enroll, host ws) are
relayed only while a laptop is connected to `/_zcc/relay`. Set `ZCC_RELAY_TOKEN`
in the platform config (never in the image).

`NEXT_PUBLIC_*` values are inlined at **build time**, so pass feed URLs as Docker
build arguments rather than runtime environment variables. Set `PUBLIC_BASE_URL`
in production so canonical URLs, `robots.txt`, and the sitemap use the real HTTPS
origin.

Build and run locally:

```bash
cd website
docker build -t zcc-web .
docker run --rm -p 4321:4321 -e PORT=4321 -e ZCC_RELAY_TOKEN=dev \
  -e PUBLIC_BASE_URL=https://zcc-7808c5bc8f3d.herokuapp.com zcc-web
curl -sI http://127.0.0.1:4321/ | head -n1          # Next
curl -sI http://127.0.0.1:4321/install.sh | head -n1 # 503 until a laptop is connected, not 308
```

To publish to Heroku app `zcc`:

```bash
cd website
heroku container:login
heroku config:set ZCC_RELAY_TOKEN=... PUBLIC_BASE_URL=https://zcc-7808c5bc8f3d.herokuapp.com -a zcc
# Docker 29+ defaults to OCI media types that Heroku's registry rejects
# (`error from registry: unsupported`). Force Docker schema 2 + gzip:
docker buildx build --platform linux/amd64 --provenance=false --sbom=false \
  --output 'type=image,name=registry.heroku.com/zcc/web:latest,push=true,oci-mediatypes=false,compression=gzip,force-compression=true' .
heroku container:release web -a zcc
```

`heroku.yml` lives under `website/` — push from that directory. The `web`
process must stay `node relay/front-door.mjs`, not `node server.js`. The live
hostname is `https://zcc-7808c5bc8f3d.herokuapp.com` (not `zcc.herokuapp.com`).

## Adding a doc

Edit the `DOCS` allowlist in `scripts/sync-docs.mjs`, then run
`npm run sync-docs` (also a `predev` / `prebuild` hook). Only listed files are
published; this is deliberate so internal `docs/*` (audits, plans, reviews)
stay private. `lib/docs.ts` reads the generated `content/docs/_manifest.json`.

## Official plugin marketplace

`scripts/generate-marketplace.mjs` writes `content/marketplace/marketplace.json`
from the repo `plugins/` tree (git pointers with `subdir: plugins/<id>`). The
site serves it at `/marketplace/v1/marketplace.json`. Point a packaged app at
that HTTPS URL with `ZCC_OFFICIAL_MARKETPLACE_URL` so PluginService can seed
the official catalog on boot (fail-soft if the feed is unreachable).
