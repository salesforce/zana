import { ImageResponse } from 'next/og';
import { site } from '@/lib/site';

/**
 * Site-wide default social card, generated at build time via Satori/ImageResponse
 * (no static asset to maintain). Per-page metadata inherits this unless a route
 * defines its own opengraph-image. Palette matches globals.css — the "fairy of
 * the mountains" identity: forest #2d5f3f → moss #4a7856, gold #c9a961 on cream.
 */
export const runtime = 'nodejs';
export const alt = 'Zana Command Center — the cockpit for Claude Code';
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
          background: 'linear-gradient(135deg, #faf6e8 0%, #f3ebd3 55%, #eadfc0 100%)',
          color: '#1f2a24',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <div
            style={{
              width: 68,
              height: 68,
              borderRadius: 18,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 40,
              fontWeight: 700,
              color: '#e5d4a1',
              background: 'linear-gradient(135deg, #2d5f3f, #4a7856)'
            }}
          >
            Z
          </div>
          <div style={{ fontSize: 30, fontWeight: 600, color: '#5b6b5f' }}>Zana Command Center</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 600, color: '#7d5f1f', letterSpacing: '0.24em', textTransform: 'uppercase' }}>
— a cockpit for Claude Code —
          </div>
          <div style={{ fontSize: 74, fontWeight: 700, lineHeight: 1.04, letterSpacing: '-0.02em', maxWidth: 980, color: '#2d5f3f' }}>
            Make the wishes. The work gets done.
          </div>
          <div style={{ fontSize: 30, color: '#5b6b5f', maxWidth: 900 }}>{site.tagline}</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 18, fontSize: 24, color: '#5b6b5f' }}>
          <span
            style={{
              padding: '8px 18px',
              borderRadius: 999,
              border: '1px solid #d8c99e',
              color: '#2d5f3f'
            }}
          >
            macOS · Windows · Linux
          </span>
          <span style={{ color: '#4a7856' }}>● Free &amp; open</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
