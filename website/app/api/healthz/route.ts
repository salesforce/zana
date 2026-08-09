/**
 * Lightweight dynamic health endpoint, kept outside the optional CIDR gate so
 * platform probes can verify the service independently of visitor access.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true });
}
