import Link from 'next/link';
import type { Metadata } from 'next';
import { site } from '@/lib/site';
import { AuroraGrid } from './components/AuroraGrid';
import { ProductDemo } from './components/product-tour/ProductDemo';

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

          <div className="wrap home-tour">
            <ProductDemo />
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
