/**
 * The pure publish pipeline (design §5 "Publish API pipeline"), factored out
 * of the route handler so it's directly unit-testable without driving the
 * App Router request/response plumbing — same precedent as
 * `completeGithubLogin` in `lib/auth.ts`.
 *
 * Byte/validation rules are reproduced EXACTLY from the frozen desktop client
 * (`apps/server/src/services/extensions/extension-registry.ts::decodeArchive`, `ARCHIVE_MAX_BYTES`) and
 * `scripts/publish-extension.mjs::buildArchive` — re-declared here rather than
 * imported, since `website/` has no dependency on the app's `src/main/**`
 * (same "locally mirrored, not imported" precedent `lib/registry.ts` and
 * `lib/feed.ts` established for the SDK types).
 *
 * Pipeline (fail-closed, in order — design §5):
 *   1. Derive canonical archive bytes from the request body.
 *   2. Size cap (≤ 16 MiB) → `too_large` (413).
 *   3. Archive shape (`decodeArchive` rules) → `bad_archive` (400).
 *   4. Manifest fields + id match → `bad_manifest` (400).
 *   5. Ownership (first-publish-claims else owner-only) → `not_owner` (403).
 *   6. Monotonicity (`compareVersions` > 0, no re-publish) → `stale_version` (409).
 *   7. Sign + hash the bytes.
 *   8. Insert the `releases` row (and `extensions` row on first publish).
 *   9. Return the `RegistryRelease` projection.
 */
import { eq } from 'drizzle-orm';
import { getDb, type AnyDb } from './db/index.ts';
import { sha256Hex, signEd25519 } from './signing.ts';
import { compareVersions, type RegistryRelease } from './registry.ts';
import type { PublishRequestBody } from './validation.ts';
import type { User, NewExtension, NewRelease, Extension } from './db/schema.sqlite.ts';

/** Matches `apps/server/src/services/extensions/extension-registry.ts::ARCHIVE_MAX_BYTES` (16 MiB per release). */
export const ARCHIVE_MAX_BYTES = 16 * 1024 * 1024;

export type PublishErrorCode = 'bad_archive' | 'bad_manifest' | 'not_owner' | 'stale_version' | 'too_large';

export interface PublishSuccess {
  status: 201;
  release: RegistryRelease;
}

export interface PublishFailure {
  status: 400 | 403 | 409 | 413;
  error: PublishErrorCode;
  message: string;
}

export type PublishResult = PublishSuccess | PublishFailure;

/** The subset of `User` the pipeline needs (ownership id + attribution handle). */
export type PublishUser = Pick<User, 'id' | 'githubLogin'>;

export interface PublishReleaseParams {
  /** The `:id` route param — MUST match the derived plugin id (`package.json` `name`). */
  id: string;
  user: PublishUser;
  body: PublishRequestBody;
}

// ---------------------------------------------------------------------------
// Canonical archive bytes
// ---------------------------------------------------------------------------

/**
 * Derive the exact bytes to hash + sign + store, mirroring
 * `publish-extension.mjs::buildArchive`'s `Buffer.from(JSON.stringify({ files }))`
 * convention when the request sends a decoded file map, or storing the given
 * base64 payload verbatim when the request already carries the full archive
 * (CLI parity — never re-serialize what the caller built).
 */
function deriveArchiveBytes(body: PublishRequestBody): Buffer {
  if ('archiveBase64' in body) {
    return Buffer.from(body.archiveBase64, 'base64');
  }
  return Buffer.from(JSON.stringify({ files: body.archive.files }));
}

// ---------------------------------------------------------------------------
// `decodeArchive` rules, reproduced EXACTLY from `apps/server/src/services/extensions/extension-registry.ts`
// ---------------------------------------------------------------------------

type ArchiveFiles = Record<string, Buffer>;

class BadArchiveError extends Error {}

/**
 * Parse + validate the JSON file-bundle archive with the SAME rules the
 * engine's `decodeArchive` enforces: reject names containing `/`, `\`, `..`,
 * or a leading `.`, and require `package.json` (or a one-release
 * `extension.json` shim). Throws `BadArchiveError` on any violation
 * (fail-closed) so the caller maps it to `400 bad_archive`.
 */
function decodeArchive(bytes: Buffer): ArchiveFiles {
  let parsed: { files?: unknown };
  try {
    parsed = JSON.parse(bytes.toString('utf-8')) as { files?: unknown };
  } catch {
    throw new BadArchiveError('archive is not valid JSON');
  }
  if (!parsed.files || typeof parsed.files !== 'object' || Array.isArray(parsed.files)) {
    throw new BadArchiveError('archive has no files map');
  }
  const out: ArchiveFiles = {};
  for (const [name, b64] of Object.entries(parsed.files as Record<string, unknown>)) {
    if (typeof b64 !== 'string') throw new BadArchiveError(`archive file ${name} is not a base64 string`);
    if (name.includes('/') || name.includes('\\') || name.includes('..') || name.startsWith('.')) {
      throw new BadArchiveError(`archive file name rejected (path escape): ${name}`);
    }
    out[name] = Buffer.from(b64, 'base64');
  }
  if (!out['package.json'] && !out['extension.json']) {
    throw new BadArchiveError('archive missing package.json');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manifest parsing
// ---------------------------------------------------------------------------

interface Manifest {
  id: string;
  version: string;
  zccApi: string;
  title?: string;
  description?: string;
  author?: string;
  icon?: string;
  permissions?: string[];
}

class BadManifestError extends Error {}

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const BUILTIN_NAV_SENTINEL = '__builtin__';

/**
 * Mirror of `packages/domain/src/plugin-id.ts` `derivePluginId` — website/
 * does not depend on that package (same locally-mirrored posture as
 * `lib/registry.ts`). Keep the two copies byte-identical on the algorithm.
 */
function derivePluginId(packageName: string): string {
  if (packageName === BUILTIN_NAV_SENTINEL) {
    throw new Error(`cannot derive a plugin id from package name "${packageName}"`);
  }
  const base = packageName.includes('/')
    ? (packageName.split('/').at(-1) ?? packageName)
    : packageName;
  const id = base
    .replace(/^(zcc|zana)-plugin-/, '')
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/^-+|-+$/g, '');
  if (id.length === 0 || id === BUILTIN_NAV_SENTINEL || !PLUGIN_ID_PATTERN.test(id)) {
    throw new Error(`cannot derive a plugin id from package name "${packageName}"`);
  }
  return id;
}

function parseJsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    return JSON.parse(bytes.toString('utf-8')) as Record<string, unknown>;
  } catch {
    throw new BadManifestError(`${label} is not valid JSON`);
  }
}

/** Parse `package.json` → `zcc`, requiring `name`/`version`/`engines.zcc` and a derived id that matches the route. */
function parsePackageJsonManifest(raw: Record<string, unknown>, routeId: string): Manifest {
  const packageName = raw.name;
  if (typeof packageName !== 'string' || !packageName) {
    throw new BadManifestError('package.json is missing a string "name"');
  }
  let id: string;
  try {
    id = derivePluginId(packageName);
  } catch (err) {
    throw new BadManifestError(err instanceof Error ? err.message : 'cannot derive plugin id');
  }
  if (id !== routeId) {
    throw new BadManifestError(`derived plugin id "${id}" does not match route id "${routeId}"`);
  }
  const version = raw.version;
  if (typeof version !== 'string' || !version) {
    throw new BadManifestError('package.json is missing a string "version"');
  }
  const engines = raw.engines as Record<string, unknown> | undefined;
  const zccApi =
    (typeof engines?.zcc === 'string' && engines.zcc) ||
    (typeof engines?.zccApi === 'string' && engines.zccApi) ||
    '';
  if (!zccApi) throw new BadManifestError('package.json is missing engines.zcc');
  const zcc = raw.zcc as Record<string, unknown> | undefined;
  if (!zcc || typeof zcc !== 'object' || Array.isArray(zcc)) {
    throw new BadManifestError('package.json is missing a zcc block');
  }
  const branding = zcc.branding as Record<string, unknown> | undefined;
  return {
    id,
    version,
    zccApi,
    title: typeof zcc.name === 'string' ? zcc.name : undefined,
    description: typeof zcc.description === 'string' ? zcc.description : undefined,
    icon: typeof branding?.icon === 'string' ? branding.icon : undefined
  };
}

/** One-release shim: leftover `extension.json` archives still publish. */
function parseLegacyExtensionManifest(raw: Record<string, unknown>, routeId: string): Manifest {
  const id = raw.id;
  const version = raw.version;
  const engines = raw.engines as Record<string, unknown> | undefined;
  const zccApi = engines?.zccApi;
  if (typeof id !== 'string' || !id) throw new BadManifestError('manifest is missing a string "id"');
  if (typeof version !== 'string' || !version) throw new BadManifestError('manifest is missing a string "version"');
  if (typeof zccApi !== 'string' || !zccApi) throw new BadManifestError('manifest is missing engines.zccApi');
  if (id !== routeId) throw new BadManifestError(`manifest id "${id}" does not match route id "${routeId}"`);

  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.filter((p): p is string => typeof p === 'string')
    : undefined;

  return {
    id,
    version,
    zccApi,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    author: typeof raw.author === 'string' ? raw.author : undefined,
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    permissions
  };
}

function parseManifest(files: ArchiveFiles, routeId: string): Manifest {
  if (files['package.json']) {
    return parsePackageJsonManifest(parseJsonObject(files['package.json'], 'package.json'), routeId);
  }
  if (files['extension.json']) {
    return parseLegacyExtensionManifest(parseJsonObject(files['extension.json'], 'extension.json'), routeId);
  }
  throw new BadManifestError('archive is missing package.json');
}

// ---------------------------------------------------------------------------
// Dialect-narrowed query helpers (extensions / releases) — same TS2349
// workaround `lib/auth.ts`/`lib/feed.ts` use for the `getDb()` union.
// ---------------------------------------------------------------------------

async function findExtensionById(conn: AnyDb, id: string): Promise<Extension | null> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db.select().from(conn.schema.extensions).where(eq(conn.schema.extensions.id, id)).limit(1);
    return (rows[0] as Extension | undefined) ?? null;
  }
  const rows = await conn.db.select().from(conn.schema.extensions).where(eq(conn.schema.extensions.id, id)).limit(1);
  return (rows[0] as Extension | undefined) ?? null;
}

async function insertExtensionRow(conn: AnyDb, row: NewExtension): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.insert(conn.schema.extensions).values(row);
    return;
  }
  await conn.db.insert(conn.schema.extensions).values(row);
}

interface ReleaseVersionRow {
  version: string;
}

async function findReleaseVersionsForId(conn: AnyDb, extensionId: string): Promise<ReleaseVersionRow[]> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db
      .select({ version: conn.schema.releases.version })
      .from(conn.schema.releases)
      .where(eq(conn.schema.releases.extensionId, extensionId));
    return rows as ReleaseVersionRow[];
  }
  const rows = await conn.db
    .select({ version: conn.schema.releases.version })
    .from(conn.schema.releases)
    .where(eq(conn.schema.releases.extensionId, extensionId));
  return rows as ReleaseVersionRow[];
}

async function insertReleaseRow(conn: AnyDb, row: NewRelease): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.insert(conn.schema.releases).values(row);
    return;
  }
  await conn.db.insert(conn.schema.releases).values(row);
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'http://localhost:4321').replace(/\/+$/, '');
}

function signingKey(): string {
  const key = process.env.REGISTRY_SIGNING_KEY;
  if (!key) throw new Error('REGISTRY_SIGNING_KEY is not set');
  return key;
}

function fail(status: PublishFailure['status'], error: PublishErrorCode, message: string): PublishFailure {
  return { status, error, message };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Validate, sign, and store one release for `:id`, per the fail-closed
 * pipeline in design §5. DB- and env-driven ({@link getDb}, `PUBLIC_BASE_URL`,
 * `REGISTRY_SIGNING_KEY`) but not tied to the HTTP layer — a route handler
 * only needs to map the returned `status`/`error` onto a `NextResponse`.
 */
export async function publishRelease({ id, user, body }: PublishReleaseParams): Promise<PublishResult> {
  // 1. Canonical bytes.
  const bytes = deriveArchiveBytes(body);

  // 2. Size cap — checked before parsing so an oversized payload never reaches
  //    JSON.parse (fail-closed, and cheap to reject).
  if (bytes.length > ARCHIVE_MAX_BYTES) {
    return fail(413, 'too_large', `archive is ${bytes.length} bytes, over the ${ARCHIVE_MAX_BYTES}-byte cap`);
  }

  // 3. Archive shape (decodeArchive rules).
  let files: ArchiveFiles;
  try {
    files = decodeArchive(bytes);
  } catch (err) {
    return fail(400, 'bad_archive', err instanceof Error ? err.message : 'invalid archive');
  }

  // 4. Manifest.
  let manifest: Manifest;
  try {
    manifest = parseManifest(files, id);
  } catch (err) {
    return fail(400, 'bad_manifest', err instanceof Error ? err.message : 'invalid manifest');
  }

  const conn = await getDb();

  // 5. Ownership — first publish claims the id; otherwise owner-only.
  const existingExtension = await findExtensionById(conn, id);
  if (!existingExtension) {
    await insertExtensionRow(conn, { id, ownerUserId: user.id, createdAt: Date.now() });
  } else if (existingExtension.ownerUserId !== user.id) {
    return fail(403, 'not_owner', `plugin "${id}" is owned by another publisher`);
  }

  // 6. Monotonicity — never-downgrade, and reject an exact re-publish.
  const existingVersions = await findReleaseVersionsForId(conn, id);
  const maxVersion = existingVersions.reduce<string | null>(
    (acc, r) => (acc === null || compareVersions(r.version, acc) > 0 ? r.version : acc),
    null
  );
  if (maxVersion !== null && compareVersions(manifest.version, maxVersion) <= 0) {
    return fail(
      409,
      'stale_version',
      `version "${manifest.version}" is not newer than the latest published version "${maxVersion}"`
    );
  }

  // 7. Sign + hash.
  const sha256 = sha256Hex(bytes);
  const signature = signEd25519(bytes, signingKey());

  // 8. Store.
  const createdAt = Date.now();
  await insertReleaseRow(conn, {
    extensionId: id,
    version: manifest.version,
    zccApi: manifest.zccApi,
    sha256,
    signature,
    permissions: manifest.permissions ? JSON.stringify(manifest.permissions) : null,
    title: manifest.title ?? null,
    description: manifest.description ?? null,
    author: user.githubLogin,
    icon: manifest.icon ?? null,
    archiveBytes: bytes,
    archiveSize: bytes.length,
    publishedBy: user.id,
    createdAt
  });

  // 9. Project the RegistryRelease response.
  const release: RegistryRelease = {
    id,
    version: manifest.version,
    zccApi: manifest.zccApi,
    url: `${publicBaseUrl()}/extensions/archives/${id}-${manifest.version}.json`,
    sha256,
    signature
  };
  if (manifest.permissions) release.permissions = manifest.permissions;
  if (manifest.title) release.title = manifest.title;
  if (manifest.description) release.description = manifest.description;
  release.author = user.githubLogin;
  if (manifest.icon) release.icon = manifest.icon;

  return { status: 201, release };
}
