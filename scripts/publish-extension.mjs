#!/usr/bin/env node
/**
 * Publish a built extension artifact either (a) into a static HTTPS
 * marketplace directory (the original local-file mode), or (b) straight to a
 * running registry server's publish API (the `--api` mode, Phase 5).
 *
 * LOCAL-FILE MODE (default): produce a dependency-free archive, hash (and
 * optionally sign) it, and upsert a `RegistryRelease` into an `index.json`.
 * The result is a directory you serve over HTTPS; point
 * `~/.zcc/extension-registry.json` at the index and the in-app Marketplace
 * browses + installs it.
 *
 * This is the PUBLISH side of the same engine the app's remote-update channel
 * (`src/main/extension-registry.ts`) consumes — it deliberately reproduces that
 * module's contracts so a published release is installable without any guesswork:
 *   - Archive format = the JSON file-bundle `decodeArchive` expects:
 *     `{ "files": { "<name>": "<base64>" } }`. File names must NOT contain
 *     `/`, `\`, `..`, or a leading `.`, and `extension.json` MUST be present.
 *   - `sha256` = lowercase hex of the archive's raw bytes (the integrity gate).
 *   - `signature` (with --key) = Ed25519 over those bytes, base64 — matches
 *     `makeEd25519Verifier` (`crypto.verify(null, bytes, key, sig)`).
 *   - The index is `{ schema: 1, releases: RegistryRelease[] }`; catalog fields
 *     (title/description/author/icon) are read from the manifest for the browse UI.
 *
 * API MODE (`--api <baseUrl> --token <zpat_…>`, design §5 / plan Phase 5):
 * reuses the SAME `buildArchive(<extensionDir>)` to produce `{files}`, then
 * POSTs `{ archive: { files } }` to `<baseUrl>/api/extensions/<id>/releases`
 * with `Authorization: Bearer <token>`. The server hashes, signs, and stores
 * the release server-side and returns the `RegistryRelease` JSON — nothing is
 * written locally in this mode. `--api` is mutually exclusive with the
 * local-file options (`--out`/`--base-url`/`--key`/`--index`).
 *
 * No new dependencies — `node:crypto` + global `fetch` (Node 22) only. Local
 * writes are atomic (tmp + rename).
 *
 * Usage (local-file mode, default):
 *   node scripts/publish-extension.mjs <extensionDir> \
 *     [--out dist-registry/] \
 *     [--base-url https://exts.example.com] \
 *     [--key ed25519-private.pem] \
 *     [--index dist-registry/index.json]
 *
 * Usage (API mode):
 *   node scripts/publish-extension.mjs <extensionDir> \
 *     --api https://exts.example.com --token zpat_...
 *
 * `<extensionDir>` is a built artifact dir (a manifest + its runtime files, e.g.
 * `bundled-extensions/consensus`). `--base-url` is prepended to the archive filename
 * to form the release `url`; the engine REQUIRES it to be HTTPS. `--out` holds
 * the archive + (default) index; `--index` overrides the index path.
 */
import {
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  statSync
} from 'node:fs';
import { createHash, sign as cryptoSign, createPrivateKey } from 'node:crypto';
import { join, basename, dirname } from 'node:path';

function fail(msg) {
  console.error(`publish-extension: ${msg}`);
  process.exit(1);
}

const USAGE = `publish-extension — bundle + hash + (sign) + index a built extension artifact,
or publish it straight to a registry server's publish API

Usage:
  node scripts/publish-extension.mjs <extensionDir> [options]

Local-file mode (default):
  node scripts/publish-extension.mjs <extensionDir> [options]

API mode:
  node scripts/publish-extension.mjs <extensionDir> --api <baseUrl> --token <zpat_...>

Arguments:
  <extensionDir>        Built artifact dir (a manifest + its runtime files,
                         e.g. bundled-extensions/consensus).

Local-file mode options:
  --out <dir>           Output dir for the archive + default index
                        (default: dist-registry).
  --base-url <url>      HTTPS base prepended to the archive filename to form
                        the release url. The app REQUIRES https://.
  --key <pem>           Ed25519 private key to sign the archive bytes.
  --index <file>        Index path to upsert into (default: <out>/index.json).

API mode options (mutually exclusive with --out/--base-url/--key/--index):
  --api <baseUrl>       Base URL of a running registry server (e.g.
                        http://localhost:4321 or https://exts.example.com).
                        POSTs the archive to
                        <baseUrl>/api/extensions/<manifest.id>/releases and
                        prints the server-signed RegistryRelease it returns.
  --token <zpat_...>    Publish token (Bearer auth). REQUIRED with --api.

Other options:
  -h, --help            Show this help and exit.

Output (local-file mode): a directory you serve over HTTPS; point
~/.zcc/extension-registry.json at the index and the in-app Marketplace
browses + installs it.

Output (API mode): nothing is written locally — the server stores, hashes,
and signs the release; this script just prints the result.`;

/** Minimal flag parser: positional <dir> + `--flag value` pairs. */
function parseArgs(argv) {
  const opts = { out: 'dist-registry', baseUrl: '', key: null, index: null, api: null, token: null };
  let dir = null;
  let sawOut = false;
  let sawBaseUrl = false;
  let sawKey = false;
  let sawIndex = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (a === '--out') {
      opts.out = argv[++i];
      sawOut = true;
    } else if (a === '--base-url') {
      opts.baseUrl = argv[++i];
      sawBaseUrl = true;
    } else if (a === '--key') {
      opts.key = argv[++i];
      sawKey = true;
    } else if (a === '--index') {
      opts.index = argv[++i];
      sawIndex = true;
    } else if (a === '--api') opts.api = argv[++i];
    else if (a === '--token') opts.token = argv[++i];
    else if (a.startsWith('--')) fail(`unknown flag: ${a}`);
    else if (!dir) dir = a;
    else fail(`unexpected argument: ${a}`);
  }
  if (!dir) fail('missing <extensionDir> (a built artifact dir) — see --help');
  if (opts.api && (sawOut || sawBaseUrl || sawKey || sawIndex)) {
    fail('--api is mutually exclusive with --out/--base-url/--key/--index (local-file mode options) — see --help');
  }
  if (opts.api && !opts.token) {
    fail('--token <zpat_...> is required with --api — see --help');
  }
  return { dir, ...opts };
}

/** Names rejected by `decodeArchive` — keep the publish side identical. */
function badName(name) {
  return name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.');
}

/** Build the `{ files: { name: base64 } }` archive bytes from an artifact dir. */
function buildArchive(dir) {
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
  const files = {};
  for (const name of names) {
    if (badName(name)) fail(`file name rejected (path escape / hidden): ${name}`);
    files[name] = readFileSync(join(dir, name)).toString('base64');
  }
  if (!files['extension.json']) fail('artifact dir has no extension.json');
  return Buffer.from(JSON.stringify({ files }));
}

/** Atomic write: tmp sibling + rename (mirrors the engine's shared-file posture). */
function atomicWrite(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

/**
 * Print a `RegistryRelease` in the same friendly style the local-file mode
 * uses (`published <id> vX.Y.Z`, then archive/index/url lines) — here there's
 * no local archive/index path, so we print what the server told us instead.
 */
function printRelease(release) {
  console.log(`published ${release.id} v${release.version}`);
  console.log(`  sha256   → ${release.sha256}${release.signature ? ' (signed)' : ''}`);
  console.log(`  url      → ${release.url}`);
  console.log(`  zccApi   → ${release.zccApi}`);
}

/**
 * API mode: reuse `buildArchive(dir)` to produce `{files}`, POST it to
 * `<baseUrl>/api/extensions/<id>/releases` with Bearer auth, and print the
 * returned `RegistryRelease` (design §5). On any error, print the server's
 * `{error,message}` (or a network/parse error) and exit non-zero.
 */
async function publishViaApi(dir, id, baseUrl, token) {
  const bytes = buildArchive(dir);
  const files = JSON.parse(bytes.toString('utf-8')).files;

  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const url = `${trimmedBase}/api/extensions/${encodeURIComponent(id)}/releases`;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ archive: { files } })
    });
  } catch (err) {
    return fail(`request to ${url} failed: ${err instanceof Error ? err.message : err}`);
  }

  const rawBody = await response.text();
  let parsedBody;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return fail(
      `server at ${url} returned non-JSON response (status ${response.status}): ${rawBody.slice(0, 200)}`
    );
  }

  if (response.status === 201) {
    printRelease(parsedBody);
    return;
  }

  const code = parsedBody?.error ?? 'unknown_error';
  const message = parsedBody?.message ?? '(no message)';
  return fail(`publish failed (${response.status} ${code}): ${message}`);
}

async function main() {
  const { dir, out, baseUrl, key, index, api, token } = parseArgs(process.argv.slice(2));

  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`not a directory: ${dir}`);

  // Read + validate the manifest (the catalog fields feed the browse UI, and
  // its "id" is REQUIRED in both modes to build the API mode's route path).
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'extension.json'), 'utf-8'));
  } catch (err) {
    return fail(`unreadable extension.json: ${err instanceof Error ? err.message : err}`);
  }
  const id = manifest.id;
  const version = manifest.version;
  if (typeof id !== 'string' || !id) fail('manifest is missing a string "id"');
  if (typeof version !== 'string' || !version) fail('manifest is missing a string "version"');
  const zccApi = manifest?.engines?.zccApi;
  if (typeof zccApi !== 'string' || !zccApi) {
    fail('manifest is missing engines.zccApi (the host-compat range)');
  }

  if (api) {
    return publishViaApi(dir, id, api, token);
  }

  // Archive + integrity hash.
  const bytes = buildArchive(dir);
  const sha256 = createHash('sha256').update(bytes).digest('hex');

  // Optional signature (Ed25519 over the raw archive bytes).
  let signature;
  if (key) {
    try {
      const privateKey = createPrivateKey(readFileSync(key));
      signature = cryptoSign(null, bytes, privateKey).toString('base64');
    } catch (err) {
      return fail(`signing failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Write the archive: `<id>-<version>.json`.
  const archiveName = `${id}-${version}.json`;
  const archivePath = join(out, archiveName);
  atomicWrite(archivePath, bytes);

  // Build the release record. `url` MUST be HTTPS to be installable — warn if not.
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const url = trimmedBase ? `${trimmedBase}/${archiveName}` : archiveName;
  if (trimmedBase && !/^https:\/\//i.test(url)) {
    console.warn(`publish-extension: WARNING base-url is not HTTPS — the app will reject ${url}`);
  }
  if (!trimmedBase) {
    console.warn('publish-extension: no --base-url given; release.url is a bare filename (set it before hosting)');
  }

  const release = {
    id,
    version,
    zccApi,
    url,
    sha256,
    ...(signature ? { signature } : {}),
    ...(Array.isArray(manifest.permissions) ? { permissions: manifest.permissions } : {}),
    // Catalog metadata for the browse list (all optional; schema stays 1).
    ...(manifest.title ? { title: manifest.title } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
    ...(manifest.author ? { author: manifest.author } : {}),
    ...(manifest.icon ? { icon: manifest.icon } : {})
  };

  // Upsert into the index: replace any existing release with the same id+version,
  // otherwise append. Keeps multiple versions of an id so never-downgrade works.
  const indexPath = index ?? join(out, 'index.json');
  let idx = { schema: 1, releases: [] };
  if (existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, 'utf-8'));
      if (parsed && parsed.schema === 1 && Array.isArray(parsed.releases)) idx = parsed;
      else console.warn(`publish-extension: existing index has unexpected shape — recreating`);
    } catch {
      console.warn(`publish-extension: existing index unreadable — recreating`);
    }
  }
  idx.releases = idx.releases.filter((r) => !(r.id === id && r.version === version));
  idx.releases.push(release);
  atomicWrite(indexPath, JSON.stringify(idx, null, 2) + '\n');

  console.log(`published ${id} v${version}`);
  console.log(`  archive → ${archivePath} (sha256 ${sha256.slice(0, 12)}…${signature ? ', signed' : ''})`);
  console.log(`  index   → ${indexPath} (${idx.releases.length} release(s))`);
  console.log(`  url     → ${url}`);
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
