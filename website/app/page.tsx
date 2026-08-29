import Link from 'next/link';
import type { Metadata } from 'next';
import { site } from '@/lib/site';

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

      <section className="bb-hero" aria-labelledby="hero-heading">
        <div className="wrap bb-hero-copy">
          <p className="bb-kicker">Zana Command Center <span>beta</span></p>
          <h1 id="hero-heading">The desktop command center for your AI coding agents.</h1>
          <p className="bb-lede">
            Run the harnesses you already use across every project. See the work in motion, coordinate a fleet,
            and come back only when your judgment is needed.
          </p>
          <div className="bb-actions">
            <Link className="bb-button bb-button-primary" href="/download/">
              Download for macOS <span aria-hidden="true">&#8594;</span>
            </Link>
            <a className="bb-button bb-button-secondary" href={site.repo} target="_blank" rel="noopener noreferrer">
              View source <span aria-hidden="true">&#8599;</span>
            </a>
          </div>
          <p className="bb-install-note">Free and open source. macOS today; Windows and Linux are next.</p>
        </div>
        <div className="wrap bb-product-wrap">
          {/* next/image can freeze animated GIFs to the first frame. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="bb-hero-shot"
            src="/product-shots/agents-board.gif"
            alt="Zana Command Center Agents board with sessions grouped into Needs you, Working, Idle, and Done."
          />
        </div>
      </section>

      <section className="bb-harnesses" aria-label="Supported coding harnesses">
        <div className="wrap">
          <p>One control plane, your preferred agent</p>
          <ul>
            {HARNESSES.map((harness) => (
              <li key={harness}>{harness}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bb-final-cta" aria-labelledby="final-cta-heading">
        <div className="wrap">
          <div className="bb-final-cta-card" data-reveal>
            <p className="bb-section-label">Zana Command Center</p>
            <h2 id="final-cta-heading">Keep every agent, project, and decision in view.</h2>
            <p>Download the free desktop app and turn the terminals you already trust into an operating system for agent work.</p>
            <div className="bb-actions">
              <Link className="bb-button bb-button-primary" href="/download/">
                Download for macOS <span aria-hidden="true">&#8594;</span>
              </Link>
              <Link className="bb-button bb-button-secondary" href="/docs/">Read the docs</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
