# Release hosting — auto-updater feed + extension marketplace

**Status:** As of 2026-07, release artifacts are published to the PUBLIC repo
**github.com/grebmann1/zcc-releases** via electron-builder's github publish
provider. The auto-updater reads `latest-mac.yml` + artifacts from that repo's
GitHub Releases anonymously — no token or VPN required.

The app SOURCE CODE lives on a separate public GitHub repo — only the RELEASE
ARTIFACTS (the installable binaries, not the source) are published to the
dedicated releases repo above.

## Public release architecture

The updater must be able to fetch release metadata and artifacts without user
credentials. Publishing the feed to a public GitHub repository lets the app
check for updates on any internet-connected machine without a VPN, browser
session, or embedded credential.

## Why static hosting (not a web service)

Both feeds are **100% static files** — no dynamic behavior is required (no access
control, telemetry, per-client gating, or signed-URL minting):

| Feed | Files | Read by |
| --- | --- | --- |
| App updater | `latest-mac.yml` + `*.zip` / `*.dmg` | electron-updater (`generic` provider) |
| Marketplace | `index.json` + `{files:{…base64}}` archives | `src/main/extension-registry.ts` (`registryUrl`) |

The council rejected:

- **Option A (Heroku web service)** — a dyno has an ephemeral filesystem (so
  artifacts need external object storage _anyway_, making the dyno a pointless
  150 MB proxy), no built-in CDN, always-on cost for a sub-1 req/sec workload,
  and cold-start latency that degrades the 30-min updater poll.
- **Option D (GHE + baked-in token / `PrivateGitHubProvider`)** — embedding a
  token in the shipped app is a **CWE-798 hard-coded credential**: the same
  credential ships to every client, is extractable, and rotating it means
  re-shipping the app. **Do not do this.**

Integrity does **not** depend on host trust: the marketplace enforces
**sha256 + optional Ed25519** over archive bytes, and the macOS app is
**Developer-ID signed + notarized** (Squirrel.Mac rejects a mismatched-identity
build). A compromised host is _detected_, not silently trusted.

### Extension marketplace (future)

The extension marketplace registry (`index.json` + archives) is not yet wired to
a public host. If/when enabled, set `ZCC_EXTENSION_REGISTRY_URL` to point at the
registry base, and `src/main/extension-registry.ts` will read it when
`~/.zcc/extension-registry.json` opts in (`enabled: true`).

## How the app consumes the feeds (already wired)

Both are runtime-configurable, host-agnostic, and **opt-in** — no default URL is
baked into the code (preserves the "no host reaches out to a network by default"
invariant):

- **Updater** (`src/main/updater.ts`): if `ZCC_UPDATE_FEED_URL` (HTTPS) is set,
  the updater calls `autoUpdater.setFeedURL({ provider: 'generic', url })`,
  overriding the GHE `publish` block. Unset → unchanged GHE behavior. Non-HTTPS →
  ignored (logged), never silently insecure.
- **Marketplace** (`src/main/extension-registry.ts`): `ZCC_EXTENSION_REGISTRY_URL`
  supplies `registryUrl` when `~/.zcc/extension-registry.json` opts in
  (`enabled: true`) but omits its own URL. The env var alone does **not** enable
  the channel; an explicit file `registryUrl` always wins.

Package these env vars into the build's runtime environment (or set them in the
app's config seam) once the base URL exists.

## Publishing a release (runbook)

Releases are built **locally** and published to **github.com/grebmann1/zcc-releases**
via electron-builder's `github` publish provider. No CI secrets required — you
authenticate with your personal GitHub token (set as `GH_TOKEN` env var).

The easiest path is the **`/release` slash command** (`.claude/commands/release.md`),
which walks the whole flow: bump the version, draft the notes, run the guard, and
publish. The manual steps are below.

### Release notes are required (bundled + guarded)

Before you build, write **`docs/releases/<version>.md`** for the new version. These
curated notes are now **bundled into the app** (electron-builder `extraResources`
copies `docs/releases` → `resourcesPath/release-notes`) and rendered by the in-app
**"What's New" modal** on the first launch after an update (see
`src/main/release-notes.ts`). A guard — `scripts/check-release-notes.mjs`, wired
into `dist`/`dist:mac`/`release:mac` (via `check:release-notes`) **and** CI's
verify job — **fails the build if the notes file for the current `package.json`
version is missing or trivially short**. So the notes can never lag the version
again.

**Write these for END USERS, not engineers** — they render in the in-app "What's
New" modal on first launch after an update. Match the format of the existing
`docs/releases/*.md` files: `# What's new in <version>`, a one-line theme, then
`## ✨ New` / `## 💬 Improved` / `## 🐛 Fixed` sections. Lead each bullet with the
user-facing benefit in bold; use plain language; **no file paths, code, or
internal jargon**. Call out anything that ships off-by-default. (Only the
current version's file is shown in the auto-modal; the About screen can show the
full history.)

```sh
# Build, sign, notarize, and publish to github.com/grebmann1/zcc-releases
# (release:mac runs the notes guard first, so a missing notes file stops here).
export GH_TOKEN=<your-github-personal-access-token>
npm run release:mac
```

This produces `dist/latest-mac.yml` + `dist/*.zip` + `dist/*.dmg` (signed +
notarized) and uploads them to the GitHub Release for the current version tag.
**IMPORTANT:** After the release workflow completes, go to
github.com/grebmann1/zcc-releases/releases and **mark the Release as published**
(not draft) so the auto-updater can see it. The updater reads that repo
anonymously, so a draft Release is invisible to it.

### Alternative: static CDN hosting (generic provider)

If you want to host the release feed on a static CDN (S3, Cloudflare Pages,
etc.) instead of GitHub Releases, set `ZCC_UPDATE_FEED_URL` (HTTPS) in the app's
runtime environment. The updater will call `autoUpdater.setFeedURL({ provider:
'generic', url })`, overriding the `publish` block. See `src/main/updater.ts`
for the wiring. Use the `release:static` script to build and upload:

```sh
ZCC_RELEASE_BASE=s3://<bucket>/app-updates npm run release:static
# backend auto-detected from scheme: s3:// → aws CLI; file:// → local copy
```

`scripts/upload-release.mjs` parses `latest-mac.yml` and uploads **only** the
files it references (plus the yml), so a stray `dist/` file can't leak. It never
reads or embeds credentials — the `aws` CLI uses the shell's own session.
