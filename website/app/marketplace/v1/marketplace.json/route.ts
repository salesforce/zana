import { NextResponse } from 'next/server';
import { MARKETPLACE_JSON_HEADERS } from '../../../../lib/official-marketplace';
import { loadOfficialMarketplace } from '../../../../lib/live-marketplace';

/**
 * BB-shaped provenance catalog. `zcc marketplace add` fetches this index.
 * Refresh does not execute plugin code. Served from the repository's default
 * branch (cached), so merged entries go live without a redeploy.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await loadOfficialMarketplace(), {
    headers: MARKETPLACE_JSON_HEADERS
  });
}
