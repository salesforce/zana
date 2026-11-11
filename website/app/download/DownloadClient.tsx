'use client';

import { useEffect, useState } from 'react';
import { site } from '../../lib/site';
import { detectPlatform, type Platform, type ReleaseAssets } from '../../lib/downloads';
import { AuroraGrid } from '../components/AuroraGrid';
import styles from './download.module.css';

const AppleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M16.37 12.6c-.03-2.5 2.04-3.7 2.13-3.76-1.16-1.7-2.97-1.93-3.6-1.96-1.53-.16-3 .9-3.78.9-.79 0-1.99-.88-3.27-.85-1.68.03-3.23.98-4.1 2.48-1.75 3.03-.45 7.51 1.25 9.97.83 1.2 1.82 2.55 3.12 2.5 1.25-.05 1.73-.81 3.25-.81s1.94.81 3.27.78c1.35-.03 2.2-1.22 3.02-2.43.95-1.39 1.34-2.74 1.37-2.81-.03-.01-2.63-1.01-2.66-4.01zM13.9 5.2c.69-.84 1.16-2 1.03-3.16-1 .04-2.2.66-2.92 1.5-.64.74-1.2 1.92-1.05 3.05 1.11.09 2.24-.56 2.94-1.39z"/></svg>
);
const WindowsIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M3 5.5l7.5-1v6.7H3V5.5zm8.6-1.2L21 3v8.2h-9.4V4.3zM3 12.8h7.5v6.7L3 18.5v-5.7zm8.6 0H21V21l-9.4-1.3v-6.9z"/></svg>
);
const LinuxIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9l3 3-3 3M12.5 15H17"/></svg>
);

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
    <div key="mac" className={`zcc-panel dl-card ${styles.card}${windowsFirst ? '' : ` dl-card-primary ${styles.primary}`}`} data-reveal>
      <div className={styles.head}>
        <span className={styles.tile}><AppleIcon /></span>
        <h2>macOS</h2>
      </div>
      <p className={styles.sub}>Apple Silicon or Intel · signed and notarized · .dmg · auto-updates in-app</p>
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
    <div key="windows" className={`zcc-panel dl-card ${styles.card}${windowsFirst ? ` dl-card-primary ${styles.primary}` : ''}`} data-reveal>
      <div className={styles.head}>
        <span className={styles.tile}><WindowsIcon /></span>
        <h2>
          Windows <span className="new-badge">New</span>
        </h2>
      </div>
      <p className={styles.sub}>x64 · NSIS installer · .exe · auto-updates in-app</p>
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
          <div className={`zcc-panel dl-soon-row ${styles.soon}`}>
            <span className={styles.tile}><LinuxIcon /></span>
            <h3>Linux</h3>
            <p>AppImage</p>
            <span className="wip-badge">Coming soon</span>
          </div>
        </div>

        <p className="dl-all">
          Release notes, checksums, and older versions are on{' '}
          <a href={releasesPage}>GitHub Releases</a>.
        </p>

        <div className={`source-split zcc-panel ${styles.source}`}>
          <div>
            <span className="zcc-kicker">From source</span>
            <h2>Build Zana <span>locally.</span></h2>
            <p>Clone the repository, install dependencies, and run the development app.</p>
          </div>
          <div>
            <div className={styles.term}>
              <div className={styles.termBar} aria-hidden="true"><i /><i /><i /><span>terminal</span></div>
              <pre className={`command-block ${styles.pre}`}>
                <code>git clone {site.repo}.git{'\n'}cd zana{'\n'}pnpm install{'\n'}pnpm dev</code>
              </pre>
            </div>
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
