/**
 * `GET /api/auth/github/login` (design §4 step 1): mint a random `state`,
 * store it in a short-lived httpOnly `oauth_state` cookie, and 302 to
 * GitHub's `authorize` endpoint carrying that same `state` — the callback
 * verifies the two match to guard the OAuth round-trip against CSRF.
 */
import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { buildAuthorizeUrl } from '@/lib/github';
import { oauthStateCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const state = randomBytes(16).toString('base64url');

  const clientId = process.env.GITHUB_CLIENT_ID ?? '';
  const redirectUri = process.env.GITHUB_OAUTH_CALLBACK ?? `${new URL(req.url).origin}/api/auth/github/callback`;

  const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state, scope: 'read:user' });

  const res = NextResponse.redirect(authorizeUrl, 302);
  res.headers.append('Set-Cookie', oauthStateCookieHeader(state));
  return res;
}
