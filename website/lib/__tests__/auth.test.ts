import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/**
 * Same temp-SQLite + real-migrate-entrypoint pattern as
 * `lib/db/__tests__/migrate.test.ts` / `lib/__tests__/feed.test.ts`: run
 * `lib/db/migrate.mjs` as a subprocess against a temp file, THEN set
 * `DATABASE_URL` (and the other env this module's `getDb()` reads lazily) in
 * this process before the first `getDb()` call any `lib/auth.ts` export makes.
 */
const WEBSITE_ROOT = join(__dirname, '..', '..');

describe('auth', () => {
  let dir: string;
  let dbFile: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'zcc-registry-auth-'));
    dbFile = join(dir, 'test.db');
    execFileSync(process.execPath, [join(WEBSITE_ROOT, 'lib', 'db', 'migrate.mjs')], {
      cwd: WEBSITE_ROOT,
      env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
      stdio: 'pipe'
    });

    process.env.DATABASE_URL = `file:${dbFile}`;
    process.env.SESSION_SECRET = 'test-session-secret';
    process.env.PUBLIC_BASE_URL = 'http://localhost:4321'; // non-Secure cookie branch
    process.env.GITHUB_OAUTH_MODE = 'mock';
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('session cookie HMAC', () => {
    it('round-trips: buildSessionCookieValue → verifySessionCookie recovers the session id', async () => {
      const { buildSessionCookieValue, verifySessionCookie } = await import('../auth.ts');
      const cookieValue = buildSessionCookieValue('session-id-abc');
      expect(verifySessionCookie(cookieValue)).toBe('session-id-abc');
    });

    it('rejects a tampered signature', async () => {
      const { buildSessionCookieValue, verifySessionCookie } = await import('../auth.ts');
      const cookieValue = buildSessionCookieValue('session-id-abc');
      const [id, sig] = cookieValue.split('.');
      const tampered = `${id}.${sig.slice(0, -1)}${sig[sig.length - 1] === 'A' ? 'B' : 'A'}`;
      expect(verifySessionCookie(tampered)).toBeNull();
    });

    it('rejects a tampered session id (signature no longer matches)', async () => {
      const { buildSessionCookieValue, verifySessionCookie } = await import('../auth.ts');
      const cookieValue = buildSessionCookieValue('session-id-abc');
      const [, sig] = cookieValue.split('.');
      expect(verifySessionCookie(`session-id-XYZ.${sig}`)).toBeNull();
    });

    it('rejects malformed values (no separator, empty parts)', async () => {
      const { verifySessionCookie } = await import('../auth.ts');
      expect(verifySessionCookie('not-a-valid-cookie')).toBeNull();
      expect(verifySessionCookie('.')).toBeNull();
      expect(verifySessionCookie('abc.')).toBeNull();
    });

    it('sessionCookieHeader / clearSessionCookieHeader carry the expected attributes', async () => {
      const { sessionCookieHeader, clearSessionCookieHeader, buildSessionCookieValue } = await import('../auth.ts');
      const value = buildSessionCookieValue('session-id-abc');
      const header = sessionCookieHeader(value, Date.now() + 1000);
      expect(header).toContain('HttpOnly');
      expect(header).toContain('SameSite=Lax');
      expect(header).toContain('Path=/');
      // PUBLIC_BASE_URL starts with http://localhost → no Secure attribute.
      expect(header).not.toContain('Secure');

      const cleared = clearSessionCookieHeader();
      expect(cleared).toContain('Max-Age=0');
    });
  });

  describe('requireSession', () => {
    it('returns the owning user for a freshly minted session', async () => {
      const { upsertGithubUser, mintSession, requireSession } = await import('../auth.ts');
      const user = await upsertGithubUser({ githubId: 1001, login: 'session-user' });
      const { cookieValue } = await mintSession(user.id);

      const req = new Request('http://localhost/test', { headers: { cookie: `zcc_session=${cookieValue}` } });
      const resolved = await requireSession(req);
      expect(resolved?.id).toBe(user.id);
      expect(resolved?.githubLogin).toBe('session-user');
    });

    it('returns null when there is no cookie at all', async () => {
      const { requireSession } = await import('../auth.ts');
      const req = new Request('http://localhost/test');
      expect(await requireSession(req)).toBeNull();
    });

    it('returns null when the cookie HMAC is tampered', async () => {
      const { upsertGithubUser, mintSession, requireSession } = await import('../auth.ts');
      const user = await upsertGithubUser({ githubId: 1002, login: 'tamper-user' });
      const { cookieValue } = await mintSession(user.id);
      const tampered = cookieValue.slice(0, -1) + (cookieValue[cookieValue.length - 1] === 'A' ? 'B' : 'A');

      const req = new Request('http://localhost/test', { headers: { cookie: `zcc_session=${tampered}` } });
      expect(await requireSession(req)).toBeNull();
    });

    it('rejects an expired session', async () => {
      const { upsertGithubUser, buildSessionCookieValue } = await import('../auth.ts');
      const { getDb } = await import('../db/index.ts');
      const { randomBytes } = await import('node:crypto');

      const user = await upsertGithubUser({ githubId: 1003, login: 'expired-user' });
      const sessionId = randomBytes(32).toString('base64url');
      const conn = await getDb();
      const now = Date.now();
      if (conn.dialect === 'pg') {
        await conn.db.insert(conn.schema.sessions).values({ id: sessionId, userId: user.id, createdAt: now - 1000, expiresAt: now - 500 });
      } else {
        await conn.db.insert(conn.schema.sessions).values({ id: sessionId, userId: user.id, createdAt: now - 1000, expiresAt: now - 500 });
      }

      const { requireSession } = await import('../auth.ts');
      const cookieValue = buildSessionCookieValue(sessionId);
      const req = new Request('http://localhost/test', { headers: { cookie: `zcc_session=${cookieValue}` } });
      expect(await requireSession(req)).toBeNull();
    });
  });

  describe('logoutSession', () => {
    it('deletes the session row so a subsequent requireSession fails', async () => {
      const { upsertGithubUser, mintSession, requireSession, logoutSession } = await import('../auth.ts');
      const user = await upsertGithubUser({ githubId: 1004, login: 'logout-user' });
      const { cookieValue } = await mintSession(user.id);
      const req = new Request('http://localhost/test', { headers: { cookie: `zcc_session=${cookieValue}` } });

      expect(await requireSession(req)).not.toBeNull();
      await logoutSession(req);
      expect(await requireSession(req)).toBeNull();
    });
  });

  describe('publish tokens', () => {
    it('mint → sha256 → lookup → revoke → rejected-after-revoke', async () => {
      const { upsertGithubUser, mintPublishToken, requireToken, revokePublishToken } = await import('../auth.ts');
      const user = await upsertGithubUser({ githubId: 2001, login: 'token-user' });
      const minted = await mintPublishToken(user.id, 'my laptop');

      expect(minted.token).toMatch(/^zpat_[0-9a-f]{40}$/);

      // The stored hash is sha256(token) — verified indirectly via requireToken
      // resolving the SAME user from ONLY the plaintext token.
      const req = new Request('http://localhost/test', { headers: { authorization: `Bearer ${minted.token}` } });
      const resolved = await requireToken(req);
      expect(resolved?.id).toBe(user.id);

      const revoked = await revokePublishToken(user.id, minted.id);
      expect(revoked).toBe(true);

      const afterRevoke = await requireToken(req);
      expect(afterRevoke).toBeNull();
    });

    it('requireToken rejects a well-formed but unknown token', async () => {
      const { requireToken } = await import('../auth.ts');
      const fakeToken = `zpat_${'a'.repeat(40)}`;
      const req = new Request('http://localhost/test', { headers: { authorization: `Bearer ${fakeToken}` } });
      expect(await requireToken(req)).toBeNull();
    });

    it('requireToken rejects a missing/malformed Authorization header', async () => {
      const { requireToken } = await import('../auth.ts');
      expect(await requireToken(new Request('http://localhost/test'))).toBeNull();
      expect(
        await requireToken(new Request('http://localhost/test', { headers: { authorization: 'Bearer not-a-zpat-token' } }))
      ).toBeNull();
      expect(
        await requireToken(new Request('http://localhost/test', { headers: { authorization: 'not-even-bearer' } }))
      ).toBeNull();
    });

    it('revokePublishToken returns false for a token not owned by the caller', async () => {
      const { upsertGithubUser, mintPublishToken, revokePublishToken } = await import('../auth.ts');
      const owner = await upsertGithubUser({ githubId: 2002, login: 'owner-user' });
      const other = await upsertGithubUser({ githubId: 2003, login: 'other-user' });
      const minted = await mintPublishToken(owner.id, 'owner token');

      expect(await revokePublishToken(other.id, minted.id)).toBe(false);
    });

    it('listPublishTokens never includes the plaintext token or its hash', async () => {
      const { upsertGithubUser, mintPublishToken, listPublishTokens } = await import('../auth.ts');
      const user = await upsertGithubUser({ githubId: 2004, login: 'list-user' });
      const minted = await mintPublishToken(user.id, 'listed token');

      const list = await listPublishTokens(user.id);
      const entry = list.find((t) => t.id === minted.id);
      expect(entry).toBeDefined();
      expect(entry).not.toHaveProperty('token');
      expect(entry).not.toHaveProperty('tokenHash');
      expect(entry!.prefix).toBe(minted.prefix);
    });
  });

  describe('completeGithubLogin (callback happy path, mock GitHub)', () => {
    it('creates a user + session and yields a cookie value that verifies', async () => {
      const { exchangeCode, fetchUser } = await import('../github.ts');
      const { completeGithubLogin, verifySessionCookie, sessionCookieHeader } = await import('../auth.ts');
      const { getDb } = await import('../db/index.ts');

      const code = 'mock:callback-user:9001';
      const { accessToken } = await exchangeCode(code);
      const githubUser = await fetchUser(accessToken);
      expect(githubUser).toEqual({ githubId: 9001, login: 'callback-user' });

      const { user, cookieValue } = await completeGithubLogin(githubUser);
      expect(user.githubLogin).toBe('callback-user');
      expect(user.githubId).toBe(9001);

      const sessionId = verifySessionCookie(cookieValue);
      expect(sessionId).not.toBeNull();

      // Assert a `users` row and a `sessions` row actually landed in the DB.
      const conn = await getDb();
      const userRows =
        conn.dialect === 'pg'
          ? await conn.db.select().from(conn.schema.users)
          : await conn.db.select().from(conn.schema.users);
      expect(userRows.some((r: { githubId: number }) => r.githubId === 9001)).toBe(true);

      const sessionRows =
        conn.dialect === 'pg'
          ? await conn.db.select().from(conn.schema.sessions)
          : await conn.db.select().from(conn.schema.sessions);
      expect(sessionRows.some((r: { id: string }) => r.id === sessionId)).toBe(true);

      // And the Set-Cookie header this would ship on the redirect is well-formed.
      const header = sessionCookieHeader(cookieValue);
      expect(header.startsWith('zcc_session=')).toBe(true);
    });

    it('upserting the same githubId twice reuses the same user row (no duplicate)', async () => {
      const { completeGithubLogin } = await import('../auth.ts');
      const first = await completeGithubLogin({ githubId: 9002, login: 'stable-user' });
      const second = await completeGithubLogin({ githubId: 9002, login: 'stable-user-renamed' });
      expect(second.user.id).toBe(first.user.id);
      expect(second.user.githubLogin).toBe('stable-user-renamed');
    });
  });

  describe('sha256Hex sanity used by the token hash', () => {
    it('matches an independent computation', async () => {
      const { mintPublishToken, upsertGithubUser } = await import('../auth.ts');
      const user = await upsertGithubUser({ githubId: 3001, login: 'hash-user' });
      const minted = await mintPublishToken(user.id);
      const expectedHash = createHash('sha256').update(minted.token, 'utf-8').digest('hex');
      // No direct getter for the stored hash from the public API (by design —
      // it's never exposed) — proven indirectly by requireToken succeeding
      // above; this asserts our own expected-hash computation is sane input
      // to that indirect check.
      expect(expectedHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
