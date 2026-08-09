import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const parentDir = resolve(__dirname, '..');
// Local installs are hoisted to the monorepo root. The Docker build copies only
// this package, where its own directory is the install root.
const workspaceRoot = existsSync(resolve(parentDir, 'package.json')) ? parentDir : __dirname;

/**
 * Runtime config. The site now needs a Node server (not a static export) so
 * `app/api/**` route handlers and the `/extensions/index.json` +
 * `/extensions/archives/[file]` feed routes have somewhere to run — static
 * export disables route handlers entirely. `output: 'standalone'` produces a
 * self-contained `.next/standalone/server.js` that the Dockerfile runs.
 *
 * Marketing/docs/marketplace pages are unaffected: Next's App Router defaults
 * pages to SSG and bakes them at build time regardless of `output` mode, so
 * they stay static/CDN-cacheable — only routes that opt into
 * `export const dynamic = 'force-dynamic'` (API + feed routes) gain a runtime.
 *
 * The marketplace catalog and download metadata are still fetched client-side
 * from the public registry/updater feeds at runtime — flip
 * `NEXT_PUBLIC_REGISTRY_URL` / `NEXT_PUBLIC_UPDATE_FEED_URL` per environment
 * without rebuilding the pages' shells.
 */
// Loud build-time warning: a production build must set PUBLIC_BASE_URL to the
// real https:// origin. Left unset, sitemap/robots/canonical URLs would resolve
// against the localhost placeholder — robots.ts defensively delists the site in
// that case, but the deploy is still misconfigured, so surface it here.
if (
  process.env.NODE_ENV === 'production' &&
  (process.env.PUBLIC_BASE_URL ?? '').startsWith('http://localhost')
) {
  console.warn(
    '\n⚠  PUBLIC_BASE_URL is unset (or still localhost) in a production build.\n' +
      '   Search engines will be DISALLOWED until you set it to the real https:// origin.\n'
  );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  images: { unoptimized: true },
  trailingSlash: true,
  // Next is hoisted to the npm workspace root, so Turbopack must resolve from
  // there rather than the website package's partial node_modules directory.
  turbopack: { root: workspaceRoot }
};

export default nextConfig;
