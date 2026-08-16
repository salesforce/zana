import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

/**
 * Site-wide default social card, generated at build time via Satori/ImageResponse
 * (no static asset to maintain). Per-page metadata inherits this unless a route
 * defines its own opengraph-image. Palette matches the desktop app's graphite,
 * blue, and gold system.
 */
export const runtime = 'nodejs';
export const alt = 'Zana Command Center — the control plane for AI coding harnesses';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: 'linear-gradient(135deg, #0b0f15 0%, #10151c 58%, #161c25 100%)',
          color: '#e6edf3',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div
            style={{
              width: 68,
              height: 68,
              display: 'flex',
              borderRadius: 18,
              overflow: 'hidden'
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${site.publicBaseUrl}/favicon.svg`} alt="" width={68} height={68} />
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, color: '#c9d1d9' }}>Zana Command Center</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 27, fontWeight: 600, color: '#58a6ff', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            — a control plane for coding harnesses —
          </div>
          <div style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.04, letterSpacing: '-0.02em', maxWidth: 980, color: '#e6edf3' }}>
            Make the work visible. Keep the momentum.
          </div>
          <div style={{ fontSize: 30, color: '#8b949e', maxWidth: 980 }}>{site.tagline}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24, color: '#8b949e' }}>
          <span
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: '1px solid #2a3340',
              color: '#c9d1d9'
            }}
          >
            macOS today · Windows &amp; Linux soon
          </span>
          <span style={{ color: '#3fb950' }}>● Free &amp; open</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
