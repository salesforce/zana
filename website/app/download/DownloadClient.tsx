'use client';

import { useEffect, useState } from 'react';
import { site } from '@/lib/site';
import { AuroraGrid } from '../components/AuroraGrid';

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
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <div className="wrap">
        <div className="zcc-hero">
          <span className="zcc-kicker">Download</span>
          <h1>Get Zana Command Center</h1>
          <p>
            Latest version <strong>v{version}</strong>
            {date ? ` · released ${new Date(date).toLocaleDateString()}` : ''}. macOS builds auto-update in-app
            after the first install.
          </p>
        </div>

        <div className="zcc-panel dl-primary" data-reveal>
          <h2>macOS</h2>
          <p>Apple Silicon or Intel · signed and notarized · .dmg</p>
          <a className="zcc-btn zcc-btn-primary" href={`${site.releasesRepo}/releases/latest`}>
            Download for macOS
          </a>
        </div>

        <div className="dl-soon" data-reveal-stagger>
          <div className="zcc-panel dl-soon-row">
            <h3>Windows</h3>
            <p>NSIS installer · .exe</p>
            <span className="wip-badge">Coming soon</span>
          </div>
          <div className="zcc-panel dl-soon-row">
            <h3>Linux</h3>
            <p>AppImage</p>
            <span className="wip-badge">Coming soon</span>
          </div>
        </div>

        <div className="source-split zcc-panel">
          <div>
            <span className="zcc-kicker">From source</span>
            <h2>Build Zana locally.</h2>
            <p>Clone the repository, install dependencies, and run the development app.</p>
          </div>
          <div>
            <pre className="command-block">
              <code>git clone {site.repo}.git{'\n'}cd zana{'\n'}pnpm install{'\n'}pnpm dev</code>
            </pre>
            <p className="source-note">
              Prerequisites: Node 20+ (22+ recommended; remotes need 22+), pnpm, and <code>git</code>. See the{' '}
              <a href="/docs/">docs</a> for source-build guidance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
