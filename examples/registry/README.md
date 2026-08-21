# Sample internal extension marketplace

This directory is a **working example** of the static marketplace the app's
remote-update / install channel consumes. It was produced by:

```sh
npm run publish-extension -- plugins/docs \
  --out examples/registry \
  --base-url https://extensions.example.com
```

It contains:

- **`index.json`** — the catalog: `{ "schema": 1, "releases": [ … ] }`. Each
  release is a `RegistryRelease` (see `packages/extension-sdk/src/index.ts`):
  `id`, `version`, `zccApi` (host-compat range), `url`, `sha256`, optional
  `signature`, `permissions`, and the catalog fields `title` / `description` /
  `author` / `icon` shown in the in-app Marketplace.
- **`<id>-<version>.json`** — one archive per release: a dependency-free JSON
  file-bundle, `{ "files": { "<name>": "<base64>" } }`. This is exactly what
  `decodeArchive` (`apps/server/src/services/extensions/extension-registry.ts`) expects — no tar/zip.

## How the app uses it

The channel is **opt-in and HTTPS-only** — the app never reaches a network by
default. To turn it on, create `~/.zcc/extension-registry.json`:

```jsonc
{
  "enabled": true,
  "registryUrl": "https://extensions.example.com/index.json",
  // Optional: pin a registry signing key. When set, every release's `signature`
  // is verified (Ed25519 over the archive bytes) before install.
  "publicKey": "-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n",
  // Optional: reject any unsigned release (recommended for production).
  "requireSignature": true
}
```

Then **Settings → Extensions → Marketplace** lists the catalog, and
**Check for updates** applies newer compatible releases. Install/update is gated
by:

- **HTTPS only** — a non-`https://` `registryUrl` or release `url` is rejected.
- **Integrity** — the downloaded bytes must match the release `sha256`.
- **Signature** (when `publicKey` is set) — Ed25519 over the archive bytes.
- **Compatibility** — `zccApi` must satisfy this host; never downgrades.
- **Consent** — a release that *widens* permissions is held back (`needs-consent`)
  until the user approves it in-app.

## Hosting

Serve this directory over HTTPS (any static host: S3 + CloudFront, GitHub Pages,
an internal nginx, …). The engine **rejects `http://`** for both the index and
each release `url`, so a plain file server on `http://` will not work — terminate
TLS in front of it.

## Publishing a new version

```sh
# 1. First-party plugins live in plugins/<id> (e.g. plugins/docs).
# 2. Publish into the registry, signing with your Ed25519 key:
npm run publish-extension -- plugins/docs \
  --out dist-registry \
  --base-url https://extensions.example.com \
  --key ./registry-signing-key.pem
# 3. Upload dist-registry/* to your HTTPS host.
```

`publish-extension` upserts by `id`+`version` (replacing a same-version entry,
appending a new one), so multiple versions of an id can coexist in the index and
the never-downgrade rule still holds.

Generate a signing keypair with:

```sh
openssl genpkey -algorithm ed25519 -out registry-signing-key.pem
openssl pkey -in registry-signing-key.pem -pubout -out registry-signing-key.pub.pem
# Put the contents of the .pub.pem into ~/.zcc/extension-registry.json `publicKey`.
```
