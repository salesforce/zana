import Link from 'next/link';
import type { Metadata } from 'next';
import { site } from '@/lib/site';
import { AuroraGrid } from './components/AuroraGrid';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { url: '/', type: 'website', images: ['/opengraph-image'] }
};

const HARNESSES = ['Claude Code', 'Cursor', 'OpenCode', 'Codex', 'Pi', 'Shell'];

const JSON_LD = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: site.name,
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'macOS',
  description: site.tagline,
  url: site.publicBaseUrl,
  downloadUrl: `${site.releasesRepo}/releases/latest`,
  softwareVersion: site.latestVersion,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
};

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <div className="home aurora-host">
        <AuroraGrid />

        <section className="home-hero" aria-labelledby="hero-heading">
          <div className="wrap home-hero-copy">
            <p className="zcc-kicker home-kicker">
              Zana Command Center <span>beta</span>
            </p>
            <h1 id="hero-heading">The desktop command center for your AI coding agents.</h1>
            <p className="home-lede">
              Run the harnesses you already use across every project. See the work in motion, coordinate a fleet,
              and come back only when your judgment is needed.
            </p>
            <div className="zcc-actions home-actions">
              <Link className="zcc-btn zcc-btn-primary zcc-btn-lg" href="/download/">
                Download for macOS
              </Link>
              <Link className="zcc-btn zcc-btn-ghost zcc-btn-lg" href="/docs/">
                Read the docs
              </Link>
            </div>
            <p className="home-note">Free and open source. macOS today; Windows and Linux are next.</p>
          </div>

          <div className="wrap">
            <div className="app-window">
              <div className="app-window-bar">
                <div className="app-window-dots" aria-hidden="true">
                  <span /><span /><span />
                </div>
                <span className="app-window-title">Agents</span>
              </div>
              {/* next/image can freeze animated GIFs to the first frame. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/product-shots/agents-board.gif"
                alt="Zana Command Center Agents board with sessions grouped into Needs you, Working, Idle, and Done."
              />
              <div className="app-window-status">Needs you · Working · Idle · Done</div>
            </div>
          </div>
        </section>

        <section className="home-workbench" aria-label="Product surfaces">
          <div className="wrap">
            <div className="home-workbench-grid" data-reveal-stagger>
              <article className="zcc-panel">
                <h3>Agents board</h3>
                <p>Every session in a lane so you can see who needs you, who is working, and who is done.</p>
                <div className="lane-row">
                  <span className="lane-chip need">Needs you</span>
                  <span className="lane-chip work">Working</span>
                  <span className="lane-chip idle">Idle</span>
                  <span className="lane-chip done">Done</span>
                </div>
              </article>
              <article className="zcc-panel">
                <h3>Inbox</h3>
                <p>Reports, ideas, and questions stay in view. Routine noise folds so it cannot bury the signal.</p>
              </article>
              <article className="zcc-panel">
                <h3>Plugins</h3>
                <p>Install marketplace capabilities or author a panel. Confirm full trust, then it runs in-process.</p>
              </article>
            </div>
          </div>
        </section>

        <section className="home-harnesses" aria-label="Supported coding harnesses">
          <div className="wrap">
            <p>Your preferred agent</p>
            <ul>
              {HARNESSES.map((harness) => (
                <li key={harness}>{harness}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="home-cta" aria-labelledby="final-cta-heading">
          <div className="wrap">
            <div className="zcc-panel" data-reveal>
              <p className="zcc-kicker">Zana Command Center</p>
              <h2 id="final-cta-heading">Keep every agent, project, and decision in view.</h2>
              <p>Download the free desktop app and turn the terminals you already trust into an operating system for agent work.</p>
              <div className="zcc-actions">
                <Link className="zcc-btn zcc-btn-primary" href="/download/">Download for macOS</Link>
                <Link className="zcc-btn zcc-btn-ghost" href="/docs/">Read the docs</Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
