'use client';

import { useEffect, useState } from 'react';
import { site } from '@/lib/site';

/** Minimal latest-mac.yml fields we surface. */
interface FeedInfo {
  version: string;
  releaseDate?: string;
}

/** Parse the few fields we need out of electron-updater's YAML (no yaml dep). */
function parseFeed(text: string): FeedInfo | null {
  const version = /^version:\s*(.+)$/m.exec(text)?.[1]?.trim();
  const releaseDate = /^releaseDate:\s*['"]?([^'"\n]+)/m.exec(text)?.[1]?.trim();
  if (!version) return null;
  return { version, releaseDate };
}

const PLATFORMS = [
  { os: '🍎', name: 'macOS', note: 'Universal · signed & notarized · .dmg', primary: true },
  { os: '🪟', name: 'Windows', note: 'NSIS installer · .exe', wip: true },
  { os: '🐧', name: 'Linux', note: 'AppImage', wip: true }
];

export function DownloadClient() {
  const [version, setVersion] = useState(site.latestVersion);
  const [date, setDate] = useState<string | undefined>();

  useEffect(() => {
    if (!site.updateFeedUrl) return;
    const url = site.updateFeedUrl.replace(/\/?$/, '/') + 'latest-mac.yml';
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((t) => {
        const info = parseFeed(t);
        if (info) {
          setVersion(info.version);
          setDate(info.releaseDate);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <section style={{ paddingTop: 56 }}>
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow">Download</span>
          <h1>Get Zana Command Center</h1>
          <p className="section-lede">
            Latest version <strong>v{version}</strong>
            {date ? ` · released ${new Date(date).toLocaleDateString()}` : ''}. macOS builds auto-update in-app
            after the first install.
          </p>
        </div>

        <div className="dl-grid" data-reveal-stagger>
          {PLATFORMS.map((p) => (
            <div
              className={`card dl-card ${p.primary ? 'featured' : ''} ${p.wip ? 'wip' : ''}`}
              key={p.name}
            >
              {p.wip && <span className="wip-badge">Coming soon</span>}
              <div className="os">{p.os}</div>
              <h3>{p.name}</h3>
              <p className="ver">{p.note}</p>
              <div style={{ marginTop: 18 }}>
                {p.wip ? (
                  <button className="btn" disabled>
                    🚧 In progress
                  </button>
                ) : (
                  <a className={`btn ${p.primary ? 'btn-primary' : ''}`} href={`${site.releasesRepo}/releases/latest`}>
                    ⬇ Download for {p.name}
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card build-source-card" style={{ marginTop: 28 }}>
          <h3>Build from source</h3>
          <p>Clone the repository, install dependencies, and run the development app:</p>
          <pre style={{ background: 'var(--bg-soft)', padding: 16, borderRadius: 10, overflowX: 'auto' }}>
            <code>git clone {site.repo}.git{'\n'}cd zana{'\n'}npm install{'\n'}npm run dev</code>
          </pre>
          <p style={{ marginTop: 8 }}>
            Prerequisites: Node 20+ and <code>git</code>. See the{' '}
            <a href="/docs/">docs</a> for source-build guidance.
          </p>
        </div>
      </div>
    </section>
  );
}
