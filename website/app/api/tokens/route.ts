/**
 * Publish-token management, session-gated (design §5 "Token management").
 *   - `POST {name}` → mint a new `zpat_…` token, returned ONCE.
 *   - `GET`         → list the caller's non-revoked tokens (never the token/hash).
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSession, unauthorized, jsonError, mintPublishToken, listPublishTokens } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const CreateTokenBody = z.object({
  name: z.string().trim().min(1).max(200).optional()
});

export async function POST(req: Request) {
  const user = await requireSession(req);
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = CreateTokenBody.safeParse(body);
  if (!parsed.success) {
    return jsonError('bad_request', 'Invalid request body', 400);
  }

  const minted = await mintPublishToken(user.id, parsed.data.name ?? null);
  return NextResponse.json({ token: minted.token }, { status: 201 });
}

export async function GET(req: Request) {
  const user = await requireSession(req);
  if (!user) return unauthorized();

  const tokens = await listPublishTokens(user.id);
  return NextResponse.json(
    tokens.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }))
  );
}
