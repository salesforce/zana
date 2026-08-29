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
  { os: '🍎', name: 'macOS', note: 'Apple Silicon or Intel · signed & notarized · .dmg', primary: true },
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
    <section className="clean-download-page">
      <div className="wrap">
        <div className="clean-page-hero clean-download-hero">
          <span className="clean-page-kicker">Download</span>
          <h1>Get Zana Command Center</h1>
          <p>
            Latest version <strong>v{version}</strong>
            {date ? ` · released ${new Date(date).toLocaleDateString()}` : ''}. macOS builds auto-update in-app
            after the first install.
          </p>
        </div>

        <div className="dl-grid" data-reveal-stagger>
          {PLATFORMS.map((p) => (
            <div
              className={`clean-platform-card ${p.primary ? 'clean-platform-card-primary' : ''} ${p.wip ? 'wip' : ''}`}
              key={p.name}
            >
              {p.wip && <span className="wip-badge">Coming soon</span>}
              <div className="os">{p.os}</div>
              <h3>{p.name}</h3>
              <p className="ver">{p.note}</p>
              <div style={{ marginTop: 18 }}>
                {p.wip ? (
                  <button className="clean-button" disabled>
                    In progress
                  </button>
                ) : (
                  <a className={`clean-button ${p.primary ? 'clean-button-dark' : ''}`} href={`${site.releasesRepo}/releases/latest`}>
                    Download for {p.name} <span aria-hidden="true">→</span>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="clean-source-card">
          <div>
            <span className="clean-page-kicker">From source</span>
            <h2>Build Zana locally.</h2>
            <p>Clone the repository, install dependencies, and run the development app.</p>
          </div>
          <div>
            <pre className="clean-command-block">
              <code>git clone {site.repo}.git{'\n'}cd zana{'\n'}pnpm install{'\n'}pnpm dev</code>
            </pre>
            <p className="clean-source-note">
              Prerequisites: Node 20+, pnpm, and <code>git</code>. See the{' '}
              <a href="/docs/">docs</a> for source-build guidance.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
