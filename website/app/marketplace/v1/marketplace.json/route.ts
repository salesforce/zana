import { NextResponse } from 'next/server';
import {
  MARKETPLACE_JSON_HEADERS,
  officialMarketplaceIndex
} from '@/lib/official-marketplace';

/**
 * BB-shaped provenance catalog. `zcc marketplace add` fetches this index.
 * Refresh does not execute plugin code.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(officialMarketplaceIndex(), {
    headers: MARKETPLACE_JSON_HEADERS
  });
}
