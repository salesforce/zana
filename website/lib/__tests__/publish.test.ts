import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verify as cryptoVerify, createPublicKey } from 'node:crypto';

/**
 * Same temp-SQLite + real-migrate-entrypoint pattern as `auth.test.ts` /
 * `feed.test.ts`: run `lib/db/migrate.mjs` as a subprocess against a temp
 * file, THEN set env (`DATABASE_URL`, `REGISTRY_SIGNING_KEY`,
 * `REGISTRY_PUBLIC_KEY`, `PUBLIC_BASE_URL`) in this process before the first
 * `getDb()` call any `lib/publish.ts` export makes.
 */
const WEBSITE_ROOT = join(__dirname, '..', '..');
const PUBLIC_BASE_URL = 'https://registry.example.test';

function b64(s: string): string {
  return Buffer.from(s, 'utf-8').toString('base64');
}

function manifestB64(fields: Record<string, unknown>): string {
  return b64(JSON.stringify(fields));
}

function pluginPackage(
  id: string,
  extra?: {
    version?: string;
    title?: string;
    description?: string;
    icon?: string;
    engines?: Record<string, unknown>;
    packageName?: string;
  }
): Record<string, unknown> {
  return {
    name: extra?.packageName ?? `zcc-plugin-${id}`,
    version: extra?.version ?? '1.0.0',
    engines: extra?.engines ?? { zcc: '^1.0.0' },
    zcc: {
      name: extra?.title ?? id,
      description: extra?.description ?? `${id} plugin`,
      branding: { icon: extra?.icon ?? 'Sparkles' },
      app: './app.js'
    }
  };
}

function pluginFiles(
  id: string,
  extra?: Parameters<typeof pluginPackage>[1] & { extraFiles?: Record<string, string> }
): Record<string, string> {
  return {
    'package.json': manifestB64(pluginPackage(id, extra)),
    ...extra?.extraFiles
  };
}

let userCounter = 30000;
function freshUser(githubLogin: string) {
  userCounter += 1;
  return { id: `user-${userCounter}`, githubLogin };
}

describe('publish', () => {
  let dir: string;
  let dbFile: string;
  let publicKeyPem: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-registry-publish-'));
    dbFile = join(dir, 'test.db');
    execFileSync(process.execPath, [join(WEBSITE_ROOT, 'lib', 'db', 'migrate.mjs')], {
      cwd: WEBSITE_ROOT,
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'pipe'
    });

    const { generateEd25519Keypair } = await import('../signing.ts');
    const { publicKeyPem: pub, privateKeyPem: priv } = generateEd25519Keypair();
    publicKeyPem = pub;

    process.env.DATABASE_URL = `file:${dbFile}`;
    process.env.REGISTRY_SIGNING_KEY = priv;
    process.env.REGISTRY_PUBLIC_KEY = pub;
    process.env.PUBLIC_BASE_URL = PUBLIC_BASE_URL;

    // Seed one `users` row per test-created author via upsertGithubUser is
    // unnecessary — publishRelease only needs { id, githubLogin } and the
    // `extensions`/`releases` FKs aren't enforced by sqlite in this schema
    // (design §3 doesn't declare FK constraints), so a synthetic user id is
    // sufficient to exercise ownership/monotonicity without a real users row.
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('happy path: publishes via {archive:{files}}, returns a RegistryRelease whose sha256/signature verify', async () => {
    const { publishRelease } = await import('../publish.ts');
    const { sha256Hex } = await import('../signing.ts');
    const user = freshUser('octocat');
    const files = pluginFiles('gus', {
      title: 'GUS',
      description: 'GUS integration',
      icon: 'Ticket',
      extraFiles: { 'main.mjs': b64('export default {}') }
    });

    const result = await publishRelease({
      id: 'gus',
      user,
      body: { archive: { files } }
    });

    expect(result.status).toBe(201);
    if (result.status !== 201) return;
    const release = result.release;
    expect(release.id).toBe('gus');
    expect(release.version).toBe('1.0.0');
    expect(release.zccApi).toBe('^1.0.0');
    expect(release.url).toBe(`${PUBLIC_BASE_URL}/extensions/archives/gus-1.0.0.json`);
    expect(release.author).toBe('octocat');
    expect(release.title).toBe('GUS');
    expect(release.permissions).toBeUndefined();

    const canonicalBytes = Buffer.from(JSON.stringify({ files }));
    expect(release.sha256).toBe(sha256Hex(canonicalBytes));

    const publicKey = createPublicKey(publicKeyPem);
    const verified = cryptoVerify(null, canonicalBytes, publicKey, Buffer.from(release.signature!, 'base64'));
    expect(verified).toBe(true);
  });

  it('happy path via {archiveBase64}: hashes/stores the base64-decoded bytes verbatim', async () => {
    const { publishRelease } = await import('../publish.ts');
    const { sha256Hex } = await import('../signing.ts');
    const user = freshUser('cli-user');

    const archiveJson = JSON.stringify({ files: pluginFiles('notes') });
    const archiveBytes = Buffer.from(archiveJson, 'utf-8');
    const archiveBase64 = archiveBytes.toString('base64');

    const result = await publishRelease({ id: 'notes', user, body: { archiveBase64 } });

    expect(result.status).toBe(201);
    if (result.status !== 201) return;
    expect(result.release.sha256).toBe(sha256Hex(archiveBytes));

    const publicKey = createPublicKey(publicKeyPem);
    const verified = cryptoVerify(null, archiveBytes, publicKey, Buffer.from(result.release.signature!, 'base64'));
    expect(verified).toBe(true);
  });

  it('first-publish-claims: a fresh id inserts an `extensions` row owned by the publisher', async () => {
    const { publishRelease } = await import('../publish.ts');
    const { getDb } = await import('../db/index.ts');
    const user = freshUser('claimer');

    const result = await publishRelease({
      id: 'freshly-claimed',
      user,
      body: { archive: { files: pluginFiles('freshly-claimed') } }
    });
    expect(result.status).toBe(201);

    const conn = await getDb();
    const rows =
      conn.dialect === 'pg'
        ? await conn.db.select().from(conn.schema.extensions)
        : await conn.db.select().from(conn.schema.extensions);
    const row = rows.find((r: { id: string }) => r.id === 'freshly-claimed');
    expect(row).toBeDefined();
    expect((row as { ownerUserId: string }).ownerUserId).toBe(user.id);
  });

  it('bad_archive: rejects a path-escaping file name', async () => {
    const { publishRelease } = await import('../publish.ts');
    const user = freshUser('escaper');

    const result = await publishRelease({
      id: 'escape-id',
      user,
      body: {
        archive: {
          files: {
            ...pluginFiles('escape-id'),
            '../evil.txt': b64('nope')
          }
        }
      }
    });

    expect(result.status).toBe(400);
    if (result.status === 400) expect(result.error).toBe('bad_archive');
  });

  it('bad_archive: rejects an archive missing package.json', async () => {
    const { publishRelease } = await import('../publish.ts');
    const user = freshUser('no-manifest');

    const result = await publishRelease({
      id: 'no-manifest-id',
      user,
      body: { archive: { files: { 'main.mjs': b64('export default {}') } } }
    });

    expect(result.status).toBe(400);
    if (result.status === 400) expect(result.error).toBe('bad_archive');
  });

  it('bad_manifest: rejects a derived plugin id that does not match the route id', async () => {
    const { publishRelease } = await import('../publish.ts');
    const user = freshUser('mismatcher');

    const result = await publishRelease({
      id: 'route-id',
      user,
      body: { archive: { files: pluginFiles('different-id') } }
    });

    expect(result.status).toBe(400);
    if (result.status === 400) expect(result.error).toBe('bad_manifest');
  });

  it('bad_manifest: rejects a package.json missing version', async () => {
    const { publishRelease } = await import('../publish.ts');
    const user = freshUser('no-version');

    const result = await publishRelease({
      id: 'no-version-id',
      user,
      body: {
        archive: {
          files: {
            'package.json': manifestB64({
              name: 'zcc-plugin-no-version-id',
              engines: { zcc: '^1.0.0' },
              zcc: { name: 'No version', description: 'missing version', branding: { icon: 'Sparkles' }, app: './app.js' }
            })
          }
        }
      }
    });

    expect(result.status).toBe(400);
    if (result.status === 400) expect(result.error).toBe('bad_manifest');
  });

  it('still publishes a leftover extension.json archive (one-release shim)', async () => {
    const { publishRelease } = await import('../publish.ts');
    const user = freshUser('legacy');

    const result = await publishRelease({
      id: 'legacy-ext',
      user,
      body: {
        archive: {
          files: {
            'extension.json': manifestB64({
              id: 'legacy-ext',
              version: '1.0.0',
              engines: { zccApi: '^1.0.0' },
              title: 'Legacy',
              permissions: ['storage']
            })
          }
        }
      }
    });

    expect(result.status).toBe(201);
    if (result.status !== 201) return;
    expect(result.release.title).toBe('Legacy');
    expect(result.release.permissions).toEqual(['storage']);
  });

  it('prefers package.json when an archive also carries extension.json', async () => {
    const { publishRelease } = await import('../publish.ts');
    const user = freshUser('both');

    const result = await publishRelease({
      id: 'both-ext',
      user,
      body: {
        archive: {
          files: {
            ...pluginFiles('both-ext', { title: 'From package.json', version: '2.0.0' }),
            'extension.json': manifestB64({
              id: 'both-ext',
              version: '1.0.0',
              engines: { zccApi: '^1.0.0' },
              title: 'From extension.json'
            })
          }
        }
      }
    });

    expect(result.status).toBe(201);
    if (result.status !== 201) return;
    expect(result.release.version).toBe('2.0.0');
    expect(result.release.title).toBe('From package.json');
  });

  it('not_owner: a second user publishing an already-claimed id is rejected', async () => {
    const { publishRelease } = await import('../publish.ts');
    const owner = freshUser('owner-a');
    const intruder = freshUser('intruder-b');

    const first = await publishRelease({
      id: 'owned-ext',
      user: owner,
      body: { archive: { files: pluginFiles('owned-ext') } }
    });
    expect(first.status).toBe(201);

    const second = await publishRelease({
      id: 'owned-ext',
      user: intruder,
      body: { archive: { files: pluginFiles('owned-ext', { version: '2.0.0' }) } }
    });
    expect(second.status).toBe(403);
    if (second.status === 403) expect(second.error).toBe('not_owner');
  });

  it('stale_version: rejects a lower version and an exact re-publish of the same version', async () => {
    const { publishRelease } = await import('../publish.ts');
    const user = freshUser('versioner');

    const first = await publishRelease({
      id: 'versioned-ext',
      user,
      body: { archive: { files: pluginFiles('versioned-ext', { version: '2.0.0' }) } }
    });
    expect(first.status).toBe(201);

    const lower = await publishRelease({
      id: 'versioned-ext',
      user,
      body: { archive: { files: pluginFiles('versioned-ext', { version: '1.9.0' }) } }
    });
    expect(lower.status).toBe(409);
    if (lower.status === 409) expect(lower.error).toBe('stale_version');

    const exact = await publishRelease({
      id: 'versioned-ext',
      user,
      body: { archive: { files: pluginFiles('versioned-ext', { version: '2.0.0' }) } }
    });
    expect(exact.status).toBe(409);
    if (exact.status === 409) expect(exact.error).toBe('stale_version');

    const higher = await publishRelease({
      id: 'versioned-ext',
      user,
      body: { archive: { files: pluginFiles('versioned-ext', { version: '2.1.0' }) } }
    });
    expect(higher.status).toBe(201);
  });

  it('too_large: rejects an archive over the 16 MiB ARCHIVE_MAX_BYTES cap', async () => {
    const { publishRelease, ARCHIVE_MAX_BYTES } = await import('../publish.ts');
    const user = freshUser('whale');

    const bigBase64 = 'A'.repeat(ARCHIVE_MAX_BYTES + 1024);

    const result = await publishRelease({
      id: 'whale-ext',
      user,
      body: {
        archive: {
          files: {
            ...pluginFiles('whale-ext'),
            'big.bin': bigBase64
          }
        }
      }
    });

    expect(result.status).toBe(413);
    if (result.status === 413) expect(result.error).toBe('too_large');
  });
});
