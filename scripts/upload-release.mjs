#!/usr/bin/env node
/**
 * Upload a locally-built mac release (the `dist/` output of `npm run dist:mac`)
 * to the STATIC object store / CDN that the app's auto-updater reads via
 * electron-updater's `generic` provider.
 *
 * Why this exists (council 2026-06-28): a login-gated internal release host
 * makes electron-updater's GitHubProvider get an HTML login page instead of
 * the feed, so the parse fails. The fix is to
 * stop depending on a code-hosting platform's release API at all: publish the
 * exact files electron-updater needs — `latest-mac.yml` + the `.zip`/`.dmg`
 * artifacts — to a plain HTTPS base, and point the app at it with
 * `ZCC_UPDATE_FEED_URL` (see src/main/updater.ts). Releases stay built LOCALLY
 * and pushed; nothing here mints or embeds a credential into the shipped app.
 *
 * The host is configuration, NOT baked into this script — supply it at run time:
 *
 *   ZCC_RELEASE_BASE=s3://my-bucket/app-updates       npm run release:static   # aws backend
 *   ZCC_RELEASE_BASE=https://host/app-updates ZCC_RELEASE_BACKEND=rsync ...     # see below
 *
 * Backends (auto-detected from the ZCC_RELEASE_BASE scheme, override with
 * ZCC_RELEASE_BACKEND):
 *   - s3://bucket/prefix          → `aws s3 cp` (needs the aws CLI + credentials
 *                                    in the shell; this script never reads keys).
 *   - file:///abs/path or a plain
 *     absolute path                → local copy (handy for a mounted share / test).
 *
 * It uploads ONLY the feed-relevant files (latest-mac.yml + every artifact the
 * yml references), so a stray dist/ file can't leak. The marketplace registry
 * (index.json + signed archives) is published separately via
 * `npm run publish-extension` and synced to the SAME base under /extensions —
 * see docs/release-hosting.md.
 *
 * No third-party deps (node builtins + the platform CLI only), matching
 * scripts/publish-extension.mjs.
 */
import { readFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const DIST = resolve(process.cwd(), 'dist');
const FEED = 'latest-mac.yml';

function die(msg) {
  console.error(`upload-release: ${msg}`);
  process.exit(1);
}

const base = process.env.ZCC_RELEASE_BASE?.trim();
if (!base) {
  die(
    'set ZCC_RELEASE_BASE to the static feed base (e.g. s3://bucket/app-updates ' +
      'or an absolute local path). The app reads this same base via ZCC_UPDATE_FEED_URL.'
  );
}

const feedPath = join(DIST, FEED);
if (!existsSync(feedPath)) {
  die(`${feedPath} not found — run \`npm run dist:mac\` first (release:static does this for you).`);
}

// Parse the feed to learn exactly which artifacts to upload. The yml lists every
// file (url + sha512 + size); we upload the yml plus each referenced url. We do a
// dependency-free line scan rather than adding a YAML parser (matches the rest of
// the build tooling staying dep-free).
const ymlText = readFileSync(feedPath, 'utf-8');
const artifacts = [...ymlText.matchAll(/^\s*-?\s*url:\s*(\S+)\s*$/gim)]
  .map((m) => m[1].trim())
  .filter((u) => u && !/^https?:/i.test(u)); // relative artifact filenames only
const files = [FEED, ...new Set(artifacts)];

for (const f of files) {
  if (!existsSync(join(DIST, f))) die(`feed references ${f} but it is missing from dist/`);
}

// Resolve the backend from the base scheme.
const backend =
  process.env.ZCC_RELEASE_BACKEND?.trim() ||
  (base.startsWith('s3://') ? 's3' : base.startsWith('file:') || base.startsWith('/') ? 'file' : '');

if (!backend) {
  die(`could not infer a backend from ZCC_RELEASE_BASE=${base}; set ZCC_RELEASE_BACKEND=s3|file`);
}

function joinBase(b, name) {
  return b.replace(/\/+$/, '') + '/' + name;
}

function uploadS3(localPath, dest) {
  // text/yaml for the feed so a browser/CDN serves it inline; default for binaries.
  const ct = dest.endsWith('.yml') ? ['--content-type', 'text/yaml'] : [];
  const r = spawnSync('aws', ['s3', 'cp', localPath, dest, ...ct], { stdio: 'inherit' });
  if (r.status !== 0) die(`aws s3 cp failed for ${dest} (is the aws CLI installed + authenticated?)`);
}

function uploadFile(localPath, dest) {
  const target = dest.startsWith('file:') ? fileURLToPath(dest) : dest;
  mkdirSync(resolve(target, '..'), { recursive: true });
  copyFileSync(localPath, target);
}

console.log(`upload-release: publishing ${files.length} file(s) to ${base} via ${backend} backend`);
for (const f of files) {
  const localPath = join(DIST, f);
  const dest = joinBase(base, f);
  if (backend === 's3') uploadS3(localPath, dest);
  else uploadFile(localPath, dest);
  console.log(`  ✓ ${f}`);
}
console.log(
  `\nDone. Point the app at this base with ZCC_UPDATE_FEED_URL=${
    base.startsWith('s3://') ? '<the https URL that fronts this bucket>' : base
  }`
);
