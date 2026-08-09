/**
 * `DELETE /api/tokens/:id`, session-gated + ownership-checked (design §5):
 * revoke (set `revokedAt`) a publish token owned by the caller. 404 when the
 * token doesn't exist, isn't owned by the caller, or is already revoked —
 * deliberately not distinguishing those cases from the response so token ids
 * aren't enumerable.
 */
import { NextResponse } from 'next/server';
import { requireSession, unauthorized, jsonError, revokePublishToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireSession(req);
  if (!user) return unauthorized();

  const { id } = await params;
  const revoked = await revokePublishToken(user.id, id);
  if (!revoked) {
    return jsonError('not_found', 'Token not found', 404);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
