import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * `GITHUB_OAUTH_MODE=mock` (design §4 testability seam): `exchangeCode` and
 * `fetchUser` must synthesize deterministic fake data from the `code` string
 * alone, with NO network call — asserted here by never hitting a real
 * fetch/mocking fetch at all and simply checking determinism + shape.
 */
describe('github (mock mode)', () => {
  const previousMode = process.env.GITHUB_OAUTH_MODE;

  beforeAll(() => {
    process.env.GITHUB_OAUTH_MODE = 'mock';
  });

  afterAll(() => {
    if (previousMode === undefined) delete process.env.GITHUB_OAUTH_MODE;
    else process.env.GITHUB_OAUTH_MODE = previousMode;
  });

  it('exchangeCode returns a deterministic fake token embedding the code, no network', async () => {
    const { exchangeCode } = await import('../github.ts');
    const result = await exchangeCode('mock:octocat:42');
    expect(result.accessToken).toBe('mock-access-token:mock:octocat:42');
  });

  it('fetchUser recovers the same identity from the token exchangeCode minted, for the mock:<login>:<id> format', async () => {
    const { exchangeCode, fetchUser } = await import('../github.ts');
    const { accessToken } = await exchangeCode('mock:octocat:42');
    const user = await fetchUser(accessToken);
    expect(user).toEqual({ githubId: 42, login: 'octocat' });
  });

  it('is deterministic — the same code always yields the same fake user', async () => {
    const { exchangeCode, fetchUser } = await import('../github.ts');
    const first = await fetchUser((await exchangeCode('mock:alice:7')).accessToken);
    const second = await fetchUser((await exchangeCode('mock:alice:7')).accessToken);
    expect(first).toEqual(second);
    expect(first).toEqual({ githubId: 7, login: 'alice' });
  });

  it('falls back to a stable pseudo-id for a code that does not match mock:<login>:<id>', async () => {
    const { exchangeCode, fetchUser } = await import('../github.ts');
    const first = await fetchUser((await exchangeCode('not-a-mock-code')).accessToken);
    const second = await fetchUser((await exchangeCode('not-a-mock-code')).accessToken);
    expect(first).toEqual(second);
    expect(typeof first.githubId).toBe('number');
    expect(first.login).toMatch(/^mock-user-\d+$/);
  });

  it('buildAuthorizeUrl builds the GitHub authorize URL with the given params (never mocked)', async () => {
    const { buildAuthorizeUrl } = await import('../github.ts');
    const url = buildAuthorizeUrl({
      clientId: 'client-123',
      redirectUri: 'http://localhost:4321/api/auth/github/callback',
      state: 'state-abc',
      scope: 'read:user'
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(parsed.searchParams.get('client_id')).toBe('client-123');
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:4321/api/auth/github/callback');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('scope')).toBe('read:user');
  });
});
