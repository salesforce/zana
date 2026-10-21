'use client';

import { useEffect, useState } from 'react';
import { site } from '../../lib/site';
import { detectPlatform, type Platform, type ReleaseAssets } from '../../lib/downloads';
import { AuroraGrid } from '../components/AuroraGrid';

const releasesPage = `${site.releasesRepo}/releases/latest`;

interface NavigatorWithHints extends Navigator {
  userAgentData?: { platform?: string };
}

export function DownloadClient({ release }: { release: ReleaseAssets }) {
  const [platform, setPlatform] = useState<Platform>('other');

  useEffect(() => {
    const nav = navigator as NavigatorWithHints;
    setPlatform(detectPlatform(nav.userAgent, nav.userAgentData?.platform));
  }, []);

  const version = release.version ?? site.latestVersion;
  // Windows visitors see Windows first; everyone else (incl. Linux and phones) sees macOS first.
  const windowsFirst = platform === 'windows';

  const mac = (
    <div key="mac" className={`zcc-panel dl-card${windowsFirst ? '' : ' dl-card-primary'}`} data-reveal>
      <h2>macOS</h2>
      <p>Apple Silicon or Intel · signed and notarized · .dmg · auto-updates in-app</p>
      <div className="dl-card-actions">
        <a
          className={`zcc-btn ${windowsFirst ? 'zcc-btn-ghost' : 'zcc-btn-primary'}`}
          data-analytics="download"
          data-platform="macOS"
          href={release.macArm ?? releasesPage}
        >
          Download for Apple Silicon
        </a>
        <a
          className="zcc-btn zcc-btn-ghost"
          data-analytics="download"
          data-platform="macOS"
          href={release.macIntel ?? releasesPage}
        >
          Download for Intel
        </a>
      </div>
      <p className="dl-hint">Not sure? Apple menu → About This Mac. “Chip: Apple M…” means Apple Silicon.</p>
    </div>
  );

  const windows = (
    <div key="windows" className={`zcc-panel dl-card${windowsFirst ? ' dl-card-primary' : ''}`} data-reveal>
      <h2>
        Windows <span className="new-badge">New</span>
      </h2>
      <p>x64 · NSIS installer · .exe · auto-updates in-app</p>
      <div className="dl-card-actions">
        <a
          className={`zcc-btn ${windowsFirst ? 'zcc-btn-primary' : 'zcc-btn-ghost'}`}
          data-analytics="download"
          data-platform="Windows"
          href={release.windows ?? releasesPage}
        >
          Download for Windows
        </a>
      </div>
      <p className="dl-hint">
        If Windows SmartScreen shows “Windows protected your PC”, choose <strong>More info → Run anyway</strong>.
      </p>
    </div>
  );

  return (
    <div className="zcc-page aurora-host">
      <AuroraGrid beams={false} />
      <div className="wrap">
        <div className="zcc-hero">
          <span className="zcc-kicker">Download</span>
          <h1>Get Zana Command Center</h1>
          <p>
            Latest version <strong>v{version}</strong>
            {release.releaseDate ? ` · released ${new Date(release.releaseDate).toLocaleDateString()}` : ''}. Free and
            open source for macOS and Windows. Updates install in-app after the first download.
          </p>
        </div>

        <div className="dl-grid">{windowsFirst ? [windows, mac] : [mac, windows]}</div>

        <div className="dl-soon" data-reveal-stagger>
          <div className="zcc-panel dl-soon-row">
            <h3>Linux</h3>
            <p>AppImage</p>
            <span className="wip-badge">Coming soon</span>
          </div>
        </div>

        <p className="dl-all">
          Release notes, checksums, and older versions are on{' '}
          <a href={releasesPage}>GitHub Releases</a>.
        </p>

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
