/**
 * `GET /api/auth/github/callback?code&state` (design §4 step 2): verify the
 * `state` query param matches the `oauth_state` cookie set by the login
 * route, exchange `code` for an access token, fetch the GitHub user, upsert
 * the `users` row, mint a session, set the session cookie, clear the state
 * cookie, and 302 to the dashboard.
 *
 * The actual user-upsert + session-mint logic lives in
 * `lib/auth.ts::completeGithubLogin` so it's unit-testable without driving
 * this route handler's Request/Response plumbing directly.
 */
import { NextResponse } from 'next/server';
import { exchangeCode, fetchUser } from '@/lib/github';
import { completeGithubLogin, readOauthStateCookie, sessionCookieHeader, clearOauthStateCookieHeader, jsonError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  if (!code || !state) {
    return jsonError('bad_request', 'Missing code or state', 400);
  }

  const cookieState = readOauthStateCookie(req);
  if (!cookieState || cookieState !== state) {
    return jsonError('invalid_state', 'OAuth state mismatch', 400);
  }

  try {
    const { accessToken } = await exchangeCode(code);
    const githubUser = await fetchUser(accessToken);
    const { cookieValue, expiresAt } = await completeGithubLogin(githubUser);

    const dashboardUrl = new URL('/dashboard', url.origin);
    const res = NextResponse.redirect(dashboardUrl, 302);
    res.headers.append('Set-Cookie', sessionCookieHeader(cookieValue, expiresAt));
    res.headers.append('Set-Cookie', clearOauthStateCookieHeader());
    return res;
  } catch (err) {
    return jsonError('github_oauth_failed', err instanceof Error ? err.message : 'GitHub OAuth failed', 502);
  }
}
