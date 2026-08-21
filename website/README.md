# Zana Command Center — website

The public face of the app: **marketing landing**, **extension marketplace**,
**docs**, and **download**. Built with Next.js (App Router) in standalone-server
mode so the site can serve its authenticated publishing API and extension feed
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
| `/marketplace` | Live fetch of `NEXT_PUBLIC_REGISTRY_URL` — the **same `index.json`** the app reads (`apps/server/src/services/extensions/extension-registry.ts`). Types mirror `packages/extension-sdk`. Falls back to bundled examples. |
| `/docs/*` | Rendered at build time from the repo's `docs/` + `README.md`, via a **curated allowlist** in `lib/docs.ts` (internal audits are NOT published) |
| `/download` | Parses `latest-mac.yml` from `NEXT_PUBLIC_UPDATE_FEED_URL`; links to GitHub Releases |

## Configure

Copy `.env.example` → `.env.local` and fill in the feed URLs once the CDN base
exists. All endpoints are env-driven so the same build points at any
environment without code changes — the same posture as the app.

## Deploy

The Dockerfile builds and runs Next's standalone server. `NEXT_PUBLIC_*` values
are inlined at **build time**, so pass feed URLs as Docker build arguments rather
than runtime environment variables. Set `PUBLIC_BASE_URL` in production so
canonical URLs, `robots.txt`, and the sitemap use the real HTTPS origin.

Build and run locally:

```bash
cd website
docker build -t zana-website .
docker run --rm -p 4321:4321 \
  -e PUBLIC_BASE_URL=https://zana.example.com \
  zana-website
```

To publish to a container platform, build the image with the public feed URLs:

```bash
docker build -t zana-website \
  --build-arg NEXT_PUBLIC_APP_VERSION=1.0.9 \
  --build-arg NEXT_PUBLIC_REGISTRY_URL=https://example.com/extensions/index.json \
  --build-arg NEXT_PUBLIC_UPDATE_FEED_URL=https://example.com/app-updates/ \
  .
```

The checked-in `heroku.yml` is an optional Heroku Container Registry deployment
example; set the application name and public URLs for your own deployment.

## Adding a doc

Edit the `DOCS` allowlist in `lib/docs.ts`. Only listed files are published;
this is deliberate so internal `docs/*` (audits, plans, reviews) stay private.
