/**
 * `POST /api/auth/logout` (design §4 step 3): delete the session row backing
 * the current cookie (if any), clear the cookie, 302 to `/`.
 */
import { NextResponse } from 'next/server';
import { logoutSession, clearSessionCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await logoutSession(req);

  const homeUrl = new URL('/', req.url);
  const res = NextResponse.redirect(homeUrl, 302);
  res.headers.append('Set-Cookie', clearSessionCookieHeader());
  return res;
}
