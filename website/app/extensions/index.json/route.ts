/**
 * Public served feed (design §6): `GET /extensions/index.json` — the SAME
 * `{ schema: 1, releases: RegistryRelease[] }` body the FROZEN desktop client
 * fetches via `fetchRegistryIndex()` and the website's own `fetchCatalog()`.
 *
 * Next.js App Router note: a route segment folder literally named
 * `index.json` (this directory) is NOT mangled — Next treats a folder name as
 * a literal URL path segment unless it uses the `[dynamic]` or `(group)`
 * conventions, neither of which applies to a dotted name. So this handler
 * really is served at the URL path `/extensions/index.json` (confirmed by
 * `next build` + a `curl` against `next start`, see Phase 4 report). No
 * rewrite/fallback route was needed.
 */
import { NextResponse } from 'next/server';
import { buildIndex, INDEX_MAX_BYTES } from '@/lib/feed';

export const dynamic = 'force-dynamic';

export async function GET() {
  const index = await buildIndex();
  const body = JSON.stringify(index);

  // Design §6 guard: the index must stay under the client's INDEX_MAX_BYTES
  // cap (it holds metadata only — archives are served separately — so this
  // holds for thousands of releases under normal use).
  const byteLength = Buffer.byteLength(body, 'utf-8');
  if (byteLength >= INDEX_MAX_BYTES) {
    // PAGING TODO: split into per-id or cursor-paged index shards once the
    // catalog grows large enough to approach this cap (see lib/feed.ts).
    console.warn(
      `extensions/index.json: served body is ${byteLength} bytes, at/over the ${INDEX_MAX_BYTES}-byte client cap`
    );
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=0, must-revalidate'
    }
  });
}
