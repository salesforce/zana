/**
 * Dev-only seed: publish the repo's example extensions into the local SQLite
 * registry so `/extensions/index.json` serves a non-empty, VERIFIABLE feed for
 * manual marketplace testing. Builds the same `{files:{…}}` archive bytes the
 * engine hashes+verifies, signs them with a throwaway Ed25519 key, and inserts
 * one `releases` row per example (raw SQL — no `.ts` imports, so plain `node`
 * runs it without a TS loader). Prints the matching REGISTRY_PUBLIC_KEY (spki
 * PEM, one line) to paste into ~/.zcc/extension-registry.json.
 *
 * NOT a production path — the real publish flow is the authenticated
 * /api/extensions/:id/releases route. Run with:
 *   DATABASE_URL="file:./dev.db" node scripts/seed-dev-registry.mjs
 */
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, sign as cryptoSign, generateKeyPairSync, createPrivateKey } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const EXAMPLES = join(REPO_ROOT, 'examples', 'extensions');

const dbSpec = (process.env.DATABASE_URL ?? 'file:./dev.db').replace(/^file:/, '');

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
function signEd25519(bytes, privateKeyPem) {
  return cryptoSign(null, bytes, createPrivateKey(privateKeyPem)).toString('base64');
}
function buildArchive(dir) {
  const files = {};
  for (const name of readdirSync(dir)) {
    // Same allowlist the engine's decodeArchive enforces (no nesting/dotfiles).
    if (name.includes('/') || name.startsWith('.')) continue;
    files[name] = readFileSync(join(dir, name)).toString('base64');
  }
  return Buffer.from(JSON.stringify({ files }));
}

if (!existsSync(EXAMPLES)) {
  console.error(`seed: no examples dir at ${EXAMPLES}`);
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const db = new Database(dbSpec);
const now = Date.now();
const ownerId = 'seed-user';

db.prepare(
  `INSERT OR IGNORE INTO users (id, github_id, github_login, avatar_url, created_at)
   VALUES (?, ?, ?, ?, ?)`
).run(ownerId, 1, 'zana', null, now);

const insertExt = db.prepare(
  `INSERT OR IGNORE INTO extensions (id, owner_user_id, created_at) VALUES (?, ?, ?)`
);
const insertRel = db.prepare(
  `INSERT OR IGNORE INTO releases
     (extension_id, version, zcc_api, sha256, signature, permissions, title,
      description, author, icon, archive_bytes, archive_size, published_by, created_at)
   VALUES (@extensionId, @version, @zccApi, @sha256, @signature, @permissions, @title,
      @description, @author, @icon, @archiveBytes, @archiveSize, @publishedBy, @createdAt)`
);

const ids = readdirSync(EXAMPLES).filter((d) => existsSync(join(EXAMPLES, d, 'extension.json')));
for (const id of ids) {
  const dir = join(EXAMPLES, id);
  const manifest = JSON.parse(readFileSync(join(dir, 'extension.json'), 'utf-8'));
  const bytes = buildArchive(dir);
  insertExt.run(manifest.id, ownerId, now);
  insertRel.run({
    extensionId: manifest.id,
    version: manifest.version,
    zccApi: manifest.engines?.zccApi ?? '^1.0.0',
    sha256: sha256Hex(bytes),
    signature: signEd25519(bytes, privateKeyPem),
    permissions: manifest.permissions ? JSON.stringify(manifest.permissions) : null,
    title: manifest.title ?? null,
    description: manifest.description ?? null,
    author: 'zana',
    icon: manifest.icon ?? null,
    archiveBytes: bytes,
    archiveSize: bytes.length,
    publishedBy: ownerId,
    createdAt: now
  });
  console.log(`seed: published ${manifest.id}@${manifest.version} (${bytes.length} bytes)`);
}
db.close();

const keyPath = join(HERE, '..', 'dev-registry-public-key.pem');
writeFileSync(keyPath, publicKeyPem);
console.log(`\nseed: wrote public key → ${keyPath}`);
console.log('seed: paste this (one-line) into ~/.zcc/extension-registry.json as "publicKey":');
console.log(JSON.stringify(publicKeyPem));
