/**
 * Session cookies + publish-token auth (design §4, plan Phase 2).
 *
 * Two auth mechanisms, both backed by the tables in `lib/db/schema.*.ts`:
 *   - Web session: `zcc_session` cookie = `<sessionId>.<base64url(HMAC_SHA256(sessionId,SESSION_SECRET))>`.
 *     `requireSession(req)` verifies the HMAC in constant time, loads the
 *     `sessions` row, checks it hasn't expired, and returns the owning `users` row.
 *   - Publish token (CLI/app, non-interactive): plaintext `zpat_<40 hex>` shown
 *     ONCE at mint time; only `sha256(token)` is stored. `requireToken(req)`
 *     parses `Authorization: Bearer zpat_…`, hashes, looks up a non-revoked
 *     `publish_tokens` row, stamps `lastUsedAt`, and returns the owning user.
 *
 * `getDb()` (lib/db/index.ts) returns a `dialect`-discriminated
 * `SqliteDb | PgDb` union — a `.select()/.insert()/.update()` on the raw union
 * is uncallable (TS2349) because `conn.db` and `conn.schema` don't correlate
 * across the union. Every query helper below narrows on `conn.dialect` first
 * (identical body in both branches), exactly the workaround `lib/feed.ts` used
 * for the same issue in Phase 4.
 */
import { NextResponse } from 'next/server';
import { randomBytes, randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb, type AnyDb } from './db/index.ts';
import { sha256Hex } from './signing.ts';
import type { GitHubUser } from './github.ts';
// Row shapes are structurally identical between schema.sqlite.ts and
// schema.pg.ts (design §3) — importing the type (erased at compile time) from
// one module is the single shared source of truth, same precedent as the
// `ReleaseRow` interface in `lib/feed.ts`.
import type { User, NewUser, NewSession, NewPublishToken } from './db/schema.sqlite.ts';

// ---------------------------------------------------------------------------
// Cookie plumbing
// ---------------------------------------------------------------------------

export const SESSION_COOKIE_NAME = 'zcc_session';
export const OAUTH_STATE_COOKIE_NAME = 'oauth_state';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** Non-HTTPS localhost dev has no TLS terminator, so `Secure` would break every cookie. */
function isLocalhostDeploy(): boolean {
  return (process.env.PUBLIC_BASE_URL ?? '').startsWith('http://localhost');
}

function cookieAttrs(maxAgeSeconds: number): string {
  const secure = isLocalhostDeploy() ? '' : '; Secure';
  return `HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}${secure}`;
}

/** Build the `Set-Cookie` header for a freshly minted session cookie value. */
export function sessionCookieHeader(cookieValue: string, expiresAtMs: number = Date.now() + SESSION_TTL_MS): string {
  const maxAgeSeconds = (expiresAtMs - Date.now()) / 1000;
  return `${SESSION_COOKIE_NAME}=${cookieValue}; ${cookieAttrs(maxAgeSeconds)}`;
}

/** Build the `Set-Cookie` header that clears the session cookie (logout). */
export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; ${cookieAttrs(0)}`;
}

/** Build the `Set-Cookie` header for the short-lived OAuth `state` round-trip cookie. */
export function oauthStateCookieHeader(state: string): string {
  return `${OAUTH_STATE_COOKIE_NAME}=${state}; ${cookieAttrs(OAUTH_STATE_TTL_MS / 1000)}`;
}

/** Build the `Set-Cookie` header that clears the OAuth state cookie once the callback consumes it. */
export function clearOauthStateCookieHeader(): string {
  return `${OAUTH_STATE_COOKIE_NAME}=; ${cookieAttrs(0)}`;
}

/** Parse one cookie's value out of a request's `Cookie` header (no external cookie lib — this repo hand-rolls crypto/http bits, see design §3). */
function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return part.slice(idx + 1).trim();
      }
    }
  }
  return null;
}

/** Read the raw OAuth `state` cookie value off an incoming callback request. */
export function readOauthStateCookie(req: Request): string | null {
  return readCookie(req, OAUTH_STATE_COOKIE_NAME);
}

// ---------------------------------------------------------------------------
// Session cookie HMAC
// ---------------------------------------------------------------------------

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('SESSION_SECRET is not set');
  return secret;
}

function hmacSessionId(sessionId: string): string {
  return createHmac('sha256', sessionSecret()).update(sessionId).digest('base64url');
}

/** Build the full cookie VALUE (not the header) for a given session id: `<id>.<hmac>`. */
export function buildSessionCookieValue(sessionId: string): string {
  return `${sessionId}.${hmacSessionId(sessionId)}`;
}

/**
 * Verify a session cookie's HMAC in constant time and return the embedded
 * session id, or `null` if the value is malformed or the signature doesn't match.
 */
export function verifySessionCookie(value: string): string | null {
  const dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) return null;
  const sessionId = value.slice(0, dot);
  const signature = value.slice(dot + 1);

  let expected: string;
  try {
    expected = hmacSessionId(sessionId);
  } catch {
    return null;
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || a.length === 0) return null;
  if (!timingSafeEqual(a, b)) return null;
  return sessionId;
}

// ---------------------------------------------------------------------------
// Dialect-narrowed query helpers (users / sessions / publish_tokens)
// ---------------------------------------------------------------------------

async function insertUser(conn: AnyDb, row: NewUser): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.insert(conn.schema.users).values(row);
    return;
  }
  await conn.db.insert(conn.schema.users).values(row);
}

async function updateUserProfile(conn: AnyDb, id: string, githubLogin: string, avatarUrl: string | null): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.update(conn.schema.users).set({ githubLogin, avatarUrl }).where(eq(conn.schema.users.id, id));
    return;
  }
  await conn.db.update(conn.schema.users).set({ githubLogin, avatarUrl }).where(eq(conn.schema.users.id, id));
}

async function findUserByGithubId(conn: AnyDb, githubId: number): Promise<User | null> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db.select().from(conn.schema.users).where(eq(conn.schema.users.githubId, githubId)).limit(1);
    return (rows[0] as User | undefined) ?? null;
  }
  const rows = await conn.db.select().from(conn.schema.users).where(eq(conn.schema.users.githubId, githubId)).limit(1);
  return (rows[0] as User | undefined) ?? null;
}

async function findUserById(conn: AnyDb, id: string): Promise<User | null> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db.select().from(conn.schema.users).where(eq(conn.schema.users.id, id)).limit(1);
    return (rows[0] as User | undefined) ?? null;
  }
  const rows = await conn.db.select().from(conn.schema.users).where(eq(conn.schema.users.id, id)).limit(1);
  return (rows[0] as User | undefined) ?? null;
}

interface SessionRow {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

async function insertSessionRow(conn: AnyDb, row: NewSession): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.insert(conn.schema.sessions).values(row);
    return;
  }
  await conn.db.insert(conn.schema.sessions).values(row);
}

async function findSessionById(conn: AnyDb, id: string): Promise<SessionRow | null> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db.select().from(conn.schema.sessions).where(eq(conn.schema.sessions.id, id)).limit(1);
    return (rows[0] as SessionRow | undefined) ?? null;
  }
  const rows = await conn.db.select().from(conn.schema.sessions).where(eq(conn.schema.sessions.id, id)).limit(1);
  return (rows[0] as SessionRow | undefined) ?? null;
}

async function deleteSessionRow(conn: AnyDb, id: string): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.delete(conn.schema.sessions).where(eq(conn.schema.sessions.id, id));
    return;
  }
  await conn.db.delete(conn.schema.sessions).where(eq(conn.schema.sessions.id, id));
}

interface PublishTokenRow {
  id: string;
  userId: string;
  name: string | null;
  tokenHash: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

async function insertPublishTokenRow(conn: AnyDb, row: NewPublishToken): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.insert(conn.schema.publishTokens).values(row);
    return;
  }
  await conn.db.insert(conn.schema.publishTokens).values(row);
}

async function findActiveTokenByHash(conn: AnyDb, tokenHash: string): Promise<PublishTokenRow | null> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db
      .select()
      .from(conn.schema.publishTokens)
      .where(and(eq(conn.schema.publishTokens.tokenHash, tokenHash), isNull(conn.schema.publishTokens.revokedAt)))
      .limit(1);
    return (rows[0] as PublishTokenRow | undefined) ?? null;
  }
  const rows = await conn.db
    .select()
    .from(conn.schema.publishTokens)
    .where(and(eq(conn.schema.publishTokens.tokenHash, tokenHash), isNull(conn.schema.publishTokens.revokedAt)))
    .limit(1);
  return (rows[0] as PublishTokenRow | undefined) ?? null;
}

async function touchTokenLastUsed(conn: AnyDb, id: string, lastUsedAt: number): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.update(conn.schema.publishTokens).set({ lastUsedAt }).where(eq(conn.schema.publishTokens.id, id));
    return;
  }
  await conn.db.update(conn.schema.publishTokens).set({ lastUsedAt }).where(eq(conn.schema.publishTokens.id, id));
}

async function selectActiveTokensByUser(conn: AnyDb, userId: string): Promise<PublishTokenRow[]> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db
      .select()
      .from(conn.schema.publishTokens)
      .where(and(eq(conn.schema.publishTokens.userId, userId), isNull(conn.schema.publishTokens.revokedAt)));
    return rows as PublishTokenRow[];
  }
  const rows = await conn.db
    .select()
    .from(conn.schema.publishTokens)
    .where(and(eq(conn.schema.publishTokens.userId, userId), isNull(conn.schema.publishTokens.revokedAt)));
  return rows as PublishTokenRow[];
}

async function findOwnedActiveToken(conn: AnyDb, userId: string, id: string): Promise<PublishTokenRow | null> {
  if (conn.dialect === 'pg') {
    const rows = await conn.db
      .select()
      .from(conn.schema.publishTokens)
      .where(
        and(
          eq(conn.schema.publishTokens.id, id),
          eq(conn.schema.publishTokens.userId, userId),
          isNull(conn.schema.publishTokens.revokedAt)
        )
      )
      .limit(1);
    return (rows[0] as PublishTokenRow | undefined) ?? null;
  }
  const rows = await conn.db
    .select()
    .from(conn.schema.publishTokens)
    .where(
      and(
        eq(conn.schema.publishTokens.id, id),
        eq(conn.schema.publishTokens.userId, userId),
        isNull(conn.schema.publishTokens.revokedAt)
      )
    )
    .limit(1);
  return (rows[0] as PublishTokenRow | undefined) ?? null;
}

async function setTokenRevoked(conn: AnyDb, id: string, revokedAt: number): Promise<void> {
  if (conn.dialect === 'pg') {
    await conn.db.update(conn.schema.publishTokens).set({ revokedAt }).where(eq(conn.schema.publishTokens.id, id));
    return;
  }
  await conn.db.update(conn.schema.publishTokens).set({ revokedAt }).where(eq(conn.schema.publishTokens.id, id));
}

// ---------------------------------------------------------------------------
// GitHub login → user upsert → session
// ---------------------------------------------------------------------------

/** Upsert a `users` row by `githubId` (stable identity), refreshing login/avatar if GitHub reports a change. */
export async function upsertGithubUser(githubUser: GitHubUser): Promise<User> {
  const conn = await getDb();
  const existing = await findUserByGithubId(conn, githubUser.githubId);
  const avatarUrl = githubUser.avatarUrl ?? null;

  if (existing) {
    if (existing.githubLogin !== githubUser.login || existing.avatarUrl !== avatarUrl) {
      await updateUserProfile(conn, existing.id, githubUser.login, avatarUrl);
      return { ...existing, githubLogin: githubUser.login, avatarUrl };
    }
    return existing;
  }

  const id = randomUUID();
  const createdAt = Date.now();
  await insertUser(conn, { id, githubId: githubUser.githubId, githubLogin: githubUser.login, avatarUrl, createdAt });
  return { id, githubId: githubUser.githubId, githubLogin: githubUser.login, avatarUrl, createdAt };
}

/** Mint a `sessions` row for `userId`; returns the session id, the full cookie VALUE, and its expiry (epoch ms). */
export async function mintSession(userId: string): Promise<{ sessionId: string; cookieValue: string; expiresAt: number }> {
  const sessionId = randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  const expiresAt = createdAt + SESSION_TTL_MS;
  const conn = await getDb();
  await insertSessionRow(conn, { id: sessionId, userId, createdAt, expiresAt });
  return { sessionId, cookieValue: buildSessionCookieValue(sessionId), expiresAt };
}

/**
 * Full "GitHub callback resolved to a user" pipeline, factored out of the
 * route handler so it's directly unit-testable without driving the App
 * Router request/response plumbing: upsert the user, mint a session.
 */
export async function completeGithubLogin(githubUser: GitHubUser): Promise<{ user: User; cookieValue: string; expiresAt: number }> {
  const user = await upsertGithubUser(githubUser);
  const { cookieValue, expiresAt } = await mintSession(user.id);
  return { user, cookieValue, expiresAt };
}

/**
 * Read the `zcc_session` cookie off `req`, verify its HMAC, load the session
 * row, reject if missing/expired, and return the owning `users` row (or `null`).
 */
export async function requireSession(req: Request): Promise<User | null> {
  const cookieValue = readCookie(req, SESSION_COOKIE_NAME);
  if (!cookieValue) return null;

  const sessionId = verifySessionCookie(cookieValue);
  if (!sessionId) return null;

  const conn = await getDb();
  const session = await findSessionById(conn, sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) return null;

  return findUserById(conn, session.userId);
}

/** Delete the session row (if any) matching the cookie on `req`. Idempotent no-op when the cookie is absent/invalid. */
export async function logoutSession(req: Request): Promise<void> {
  const cookieValue = readCookie(req, SESSION_COOKIE_NAME);
  if (!cookieValue) return;
  const sessionId = verifySessionCookie(cookieValue);
  if (!sessionId) return;
  const conn = await getDb();
  await deleteSessionRow(conn, sessionId);
}

// ---------------------------------------------------------------------------
// Publish tokens (PAT)
// ---------------------------------------------------------------------------

export interface MintedPublishToken {
  id: string;
  /** Plaintext `zpat_…` — shown ONCE, never stored or retrievable again. */
  token: string;
  prefix: string;
  createdAt: number;
}

export interface PublishTokenSummary {
  id: string;
  name: string | null;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Mint a new publish token for `userId`. Only `sha256(token)` is ever persisted; the plaintext is returned once. */
export async function mintPublishToken(userId: string, name?: string | null): Promise<MintedPublishToken> {
  const token = `zpat_${randomBytes(20).toString('hex')}`; // "zpat_" + 40 hex chars
  const tokenHash = sha256Hex(Buffer.from(token, 'utf-8'));
  // "first 8+ chars" (design §3) — 12 chars ("zpat_" + 7 hex) gives a
  // recognizable, still-harmless prefix for the token-list UI.
  const prefix = token.slice(0, 12);
  const id = randomUUID();
  const createdAt = Date.now();

  const conn = await getDb();
  await insertPublishTokenRow(conn, { id, userId, name: name ?? null, tokenHash, prefix, createdAt, lastUsedAt: null, revokedAt: null });

  return { id, token, prefix, createdAt };
}

/** List a user's non-revoked publish tokens, never including the plaintext or hash. */
export async function listPublishTokens(userId: string): Promise<PublishTokenSummary[]> {
  const conn = await getDb();
  const rows = await selectActiveTokensByUser(conn, userId);
  return rows
    .map((r) => ({ id: r.id, name: r.name, prefix: r.prefix, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Revoke `tokenId` iff it's owned by `userId` and not already revoked. Returns whether a row was revoked. */
export async function revokePublishToken(userId: string, tokenId: string): Promise<boolean> {
  const conn = await getDb();
  const existing = await findOwnedActiveToken(conn, userId, tokenId);
  if (!existing) return false;
  await setTokenRevoked(conn, tokenId, Date.now());
  return true;
}

const BEARER_TOKEN_RE = /^Bearer\s+(zpat_[0-9a-f]+)$/i;

/**
 * Parse `Authorization: Bearer zpat_…` off `req`, hash it, look up a
 * non-revoked `publish_tokens` row, stamp `lastUsedAt`, and return the owning
 * `users` row (or `null` for any missing/malformed/revoked/unknown token).
 */
export async function requireToken(req: Request): Promise<User | null> {
  const header = req.headers.get('authorization');
  if (!header) return null;

  const match = BEARER_TOKEN_RE.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  const tokenHash = sha256Hex(Buffer.from(token, 'utf-8'));

  const conn = await getDb();
  const tokenRow = await findActiveTokenByHash(conn, tokenHash);
  if (!tokenRow) return null;

  await touchTokenLastUsed(conn, tokenRow.id, Date.now());
  return findUserById(conn, tokenRow.userId);
}

// ---------------------------------------------------------------------------
// Error helper
// ---------------------------------------------------------------------------

/** Consistent `{ error: code, message }` JSON error response for every auth-gated route. */
export function jsonError(code: string, message: string, status: number): NextResponse {
  return NextResponse.json({ error: code, message }, { status });
}

/** Shorthand for the single most common error shape: `401 { error: 'unauthorized', message }`. */
export function unauthorized(message = 'Sign in required'): NextResponse {
  return jsonError('unauthorized', message, 401);
}
