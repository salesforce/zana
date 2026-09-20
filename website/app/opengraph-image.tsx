import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const runtime = 'nodejs';
export const alt = 'Zana — Many agents. One clear view.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage() {
  const icon = await readFile(
    join(process.cwd(), 'public', 'zana-icon-512.png')
  );
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '62px 70px',
          background: 'linear-gradient(120deg, #0d152b, #172641)',
          color: '#f0f7ff',
          fontFamily: 'sans-serif'
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span style={{ fontSize: 28, fontWeight: 600 }}>
            Zana Command Center
          </span>
          <span style={{ color: '#ffdb9e', fontSize: 19 }}>
            FREE & OPEN SOURCE
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 30
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                fontSize: 76,
                fontWeight: 700,
                letterSpacing: '-3px',
                lineHeight: 1.06
              }}
            >
              <span>Many agents.</span>
              <span style={{ color: '#93dfff' }}>One clear view.</span>
            </div>
            <span
              style={{
                color: '#b6c9e0',
                fontSize: 24,
                maxWidth: 650,
                lineHeight: 1.5
              }}
            >
              Your agents, projects, and decisions. All together.
            </span>
          </div>
          {/* Local brand artwork keeps social-card generation independent of the deployed site. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`data:image/png;base64,${icon.toString('base64')}`}
            alt=""
            width={254}
            height={254}
            style={{ borderRadius: 54 }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            borderTop: '1px solid #34496b',
            paddingTop: 24,
            color: '#b6c9e0',
            fontSize: 20
          }}
        >
          <span>zana-ide.com</span>
          <span>Make room for what comes next.</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
