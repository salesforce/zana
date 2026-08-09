/**
 * Optional network gate for deployments that need a CIDR allowlist. It applies
 * to every application and feed route through the matcher below.
 *
 * `ALLOWED_CIDRS` behavior:
 *  - Comma/space separated IPv4 CIDRs (e.g. "10.0.0.0/8, 100.64.0.0/10").
 *  - Fail-OPEN when unset/empty (a fresh deploy isn't bricked before it's
 *    configured).
 *  - Fail-CLOSED once any range is configured — an unparseable client IP is
 *    denied.
 *  - `/api/healthz` (platform health checks) is always allowed.
 *  - Client IP is the last trusted hop of `X-Forwarded-For`; configure the
 *    deployment proxy to append the real client IP and strip spoofable values.
 */
import { NextResponse, type NextRequest } from 'next/server';

function ipv4ToInt(ip: string): number | null {
  const parts = (ip || '').split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

interface CidrRange {
  network: number;
  mask: number;
}

function parseCidrs(raw: string | undefined): CidrRange[] {
  return (raw || '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [ip, bitsStr] = entry.split('/');
      const bits = bitsStr === undefined ? 32 : Number(bitsStr);
      const base = ipv4ToInt(ip);
      if (base === null || !Number.isInteger(bits) || bits < 0 || bits > 32) {
        console.warn(`ALLOWED_CIDRS: ignoring invalid entry "${entry}"`);
        return null;
      }
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return { network: (base & mask) >>> 0, mask };
    })
    .filter((v): v is CidrRange => v !== null);
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff && xff.length) {
    const hops = xff.split(',').map((s) => s.trim()).filter(Boolean);
    // The deployment proxy appends the trusted client IP as the final hop.
    let ip = hops[hops.length - 1] || '';
    if (ip.startsWith('::ffff:')) ip = ip.slice(7); // IPv4-mapped IPv6
    return ip;
  }
  // Middleware has no direct socket access; fall back to whatever Next exposes.
  return (req as unknown as { ip?: string }).ip?.replace(/^::ffff:/, '') ?? '';
}

function isAllowed(req: NextRequest, allowed: CidrRange[]): boolean {
  if (allowed.length === 0) return true; // not configured → fail open
  const n = ipv4ToInt(clientIp(req));
  if (n === null) return false; // can't determine IP → deny
  return allowed.some(({ network, mask }) => ((n & mask) >>> 0) === network);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Health check is always reachable (platform probes, uptime checks).
  // `trailingSlash: true` (next.config.mjs) makes `/api/healthz` 308-redirect
  // to `/api/healthz/` — match both so the canonical post-redirect request
  // isn't itself gated.
  if (pathname === '/api/healthz' || pathname === '/api/healthz/') {
    return NextResponse.next();
  }

  const allowed = parseCidrs(process.env.ALLOWED_CIDRS);
  if (!isAllowed(req, allowed)) {
    return new NextResponse(
      '<!doctype html><meta charset="utf-8"><title>Access restricted</title>' +
        '<body style="font-family:system-ui;background:#06070b;color:#eef0f6;display:grid;place-items:center;height:100vh;margin:0">' +
        '<div style="text-align:center;max-width:420px;padding:24px">' +
        '<h1 style="font-size:20px">Access restricted</h1>' +
        '<p style="color:#9aa1b4">This deployment is restricted by its network access policy. ' +
        'Contact the site administrator if you need access.</p></div></body>',
      { status: 403, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }

  return NextResponse.next();
}

export const config = {
  // Apply to everything except Next's own static asset internals — those are
  // hashed, immutable, and gated implicitly by needing an HTML page first.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
