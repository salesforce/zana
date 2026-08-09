/**
 * `POST /api/extensions/:id/releases` (design §5) — the publish endpoint:
 * Bearer-token auth, zod-validated body, then the pure `publishRelease`
 * pipeline (`lib/publish.ts`) owns validation/signing/storage. This handler
 * only does HTTP plumbing: auth, body parsing, and mapping the pipeline's
 * result onto a `NextResponse`.
 */
import { NextResponse } from 'next/server';
import { requireToken, unauthorized, jsonError } from '@/lib/auth';
import { PublishRequestBodySchema } from '@/lib/validation';
import { publishRelease } from '@/lib/publish';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireToken(req);
  if (!user) return unauthorized();

  const { id } = await params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError('bad_archive', 'Request body must be JSON', 400);
  }

  const parsed = PublishRequestBodySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError('bad_archive', 'Request body must be { archive: { files } } or { archiveBase64 }', 400);
  }

  const result = await publishRelease({ id, user, body: parsed.data });

  if (result.status === 201) {
    return NextResponse.json(result.release, { status: 201 });
  }
  return jsonError(result.error, result.message, result.status);
}
