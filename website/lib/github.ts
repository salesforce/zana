/**
 * GitHub OAuth HTTP calls, isolated behind an injectable seam (design §4,
 * mirroring the engine's injected `fetchBytes` pattern used elsewhere in this
 * repo) so tests never reach github.com:
 *
 *   - `GITHUB_OAUTH_MODE === 'mock'` → `exchangeCode`/`fetchUser` synthesize
 *     deterministic fake data from the `code` string, no network call at all.
 *   - anything else (unset in prod)  → real GitHub endpoints.
 *
 * Mock code format: `mock:<login>:<id>` (e.g. `mock:octocat:42`) deterministically
 * maps to `{ githubId: 42, login: 'octocat' }` — same code always yields the
 * same fake user, so callback tests can assert on a known identity without
 * any shared mutable state.
 */

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';

function isMockMode(): boolean {
  return process.env.GITHUB_OAUTH_MODE === 'mock';
}

export interface ExchangeCodeResult {
  accessToken: string;
}

export interface GitHubUser {
  githubId: number;
  login: string;
  avatarUrl?: string;
}

/** Build the GitHub `authorize` URL the login route 302s to. Never mocked — it's a redirect target, not a network call. */
export function buildAuthorizeUrl(opts: { clientId: string; redirectUri: string; state: string; scope?: string }): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('state', opts.state);
  url.searchParams.set('scope', opts.scope ?? 'read:user');
  return url.toString();
}

/**
 * Parse a `mock:<login>:<id>` code into its parts. Falls back to hashing the
 * whole code string into a stable numeric id when it doesn't match the
 * `mock:login:id` shape, so ANY code still deterministically maps to some
 * fake user in mock mode (never throws).
 */
function parseMockCode(code: string): GitHubUser {
  const parts = code.split(':');
  if (parts[0] === 'mock' && parts.length >= 3) {
    const login = parts[1];
    const id = Number(parts[2]);
    if (login && Number.isFinite(id)) {
      return { githubId: id, login };
    }
  }
  // Deterministic fallback: derive a stable pseudo-id from the code's char
  // codes so repeated calls with the same non-conforming code still agree.
  let hash = 0;
  for (let i = 0; i < code.length; i++) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return { githubId: hash || 1, login: `mock-user-${hash || 1}` };
}

/**
 * Exchange an OAuth `code` for an access token. Mock mode returns a
 * deterministic fake token (embedding the code so `fetchUser` can recover the
 * same identity) without any network call. Prod mode POSTs to GitHub's token
 * endpoint with `Accept: application/json`.
 */
export async function exchangeCode(
  code: string,
  opts?: { clientId?: string; clientSecret?: string; redirectUri?: string }
): Promise<ExchangeCodeResult> {
  if (isMockMode()) {
    return { accessToken: `mock-access-token:${code}` };
  }

  const clientId = opts?.clientId ?? process.env.GITHUB_CLIENT_ID;
  const clientSecret = opts?.clientSecret ?? process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = opts?.redirectUri ?? process.env.GITHUB_OAUTH_CALLBACK;

  const res = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });

  if (!res.ok) {
    throw new Error(`exchangeCode: GitHub token endpoint responded ${res.status}`);
  }

  const body = (await res.json()) as { access_token?: string; error?: string; error_description?: string };
  if (!body.access_token) {
    throw new Error(`exchangeCode: no access_token in response (${body.error ?? 'unknown_error'}: ${body.error_description ?? ''})`);
  }
  return { accessToken: body.access_token };
}

/**
 * Fetch the authenticated GitHub user. Mock mode recovers the deterministic
 * fake identity from the access token minted by `exchangeCode` above (no
 * network call). Prod mode GETs `api.github.com/user` with the bearer token.
 */
export async function fetchUser(accessToken: string): Promise<GitHubUser> {
  if (isMockMode()) {
    const code = accessToken.startsWith('mock-access-token:') ? accessToken.slice('mock-access-token:'.length) : accessToken;
    return parseMockCode(code);
  }

  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'zana-command-center-website'
    }
  });

  if (!res.ok) {
    throw new Error(`fetchUser: GitHub user endpoint responded ${res.status}`);
  }

  const body = (await res.json()) as { id: number; login: string; avatar_url?: string };
  return { githubId: body.id, login: body.login, avatarUrl: body.avatar_url };
}
