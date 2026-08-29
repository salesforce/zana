import { NextResponse } from 'next/server';
import {
  MARKETPLACE_JSON_HEADERS,
  OFFICIAL_MARKETPLACE_FEED_PATH,
  officialMarketplaceIndex
} from '@/lib/official-marketplace';

/**
 * Alias of `/marketplace/v1/marketplace.json` so older
 * `zcc marketplace add …/plugins/index.json` URLs keep working.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  const headers = new Headers(MARKETPLACE_JSON_HEADERS);
  headers.set('Link', `<${OFFICIAL_MARKETPLACE_FEED_PATH}>; rel="canonical"`);
  return NextResponse.json(officialMarketplaceIndex(), { headers });
}
