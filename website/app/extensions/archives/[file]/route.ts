/**
 * Public served feed (design §6): `GET /extensions/archives/<id>-<version>.json`
 * — streams the stored `archive_bytes` BLOB VERBATIM (byte-for-byte, no
 * re-serialization). These are the EXACT bytes the server hashed (`sha256`)
 * and signed (`signature`) at publish time, so the desktop client's
 * `applyRelease()` sha256 + Ed25519 gates pass only if we never touch them
 * again here.
 */
import { NextResponse } from 'next/server';
import { findArchiveByFilename } from '@/lib/feed';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const bytes = await findArchiveByFilename(file);
  if (!bytes) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // Stream the exact stored bytes verbatim — no JSON.stringify/parse
  // round-trip, which would change byte-for-byte content (whitespace, key
  // order) and break the sha256/signature the client verifies against.
  // `Buffer`'s type is generic over `ArrayBufferLike` (which includes
  // `SharedArrayBuffer`), which DOM's `BodyInit` doesn't accept under this
  // TS lib config. Copying into a plain `new Uint8Array(length)` allocates a
  // concrete `ArrayBuffer` (never a `SharedArrayBuffer`), so its type is a
  // valid `BodyInit` — same bytes, just a type-level fix, not a perf concern
  // at index-file sizes.
  const body = new Uint8Array(bytes.length);
  body.set(bytes);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=31536000, immutable'
    }
  });
}
