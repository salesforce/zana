import Link from 'next/link';
import type { Metadata } from 'next';
import { AuroraGrid } from '../components/AuroraGrid';
import { ProductGallery } from '../components/product-tour/ProductGallery';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Every Zana Command Center surface in one scroll — New Chat, Kanban, Thread, CLI agent, Inbox, Plugins, and Remote.',
  alternates: { canonical: '/features/' },
  openGraph: {
    title: 'Features — Zana Command Center',
    description:
      'See New Chat, the Agents board, Thread, CLI agent, Inbox, Plugins, and Remote as HTML product surfaces.',
    url: '/features/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

export default function FeaturesPage() {
  return (
    <>
      <section className="features-hero aurora-host" aria-labelledby="features-heading">
        <AuroraGrid beams={false} />
        <div className="wrap">
          <p className="zcc-kicker">Features</p>
          <h1 id="features-heading">Every surface, in one scroll.</h1>
          <p>
            New Chat, the Agents board, Thread, CLI agent, Inbox, Plugins, and Remote — the same fake UI as the
            homepage, stacked instead of paged.
          </p>
        </div>
      </section>
      <div className="wrap features-gallery-wrap">
        <ProductGallery />
      </div>
      <section className="home-cta" aria-labelledby="features-cta-heading">
        <div className="wrap">
          <div className="zcc-panel">
            <p className="zcc-kicker">Zana Command Center</p>
            <h2 id="features-cta-heading">Keep every agent, project, and decision in view.</h2>
            <p>
              Download the free desktop app and turn the terminals you already trust into an operating system for
              agent work.
            </p>
            <div className="zcc-actions">
              <Link className="zcc-btn zcc-btn-primary" href="/download/">
                Download for macOS
              </Link>
              <Link className="zcc-btn zcc-btn-ghost" href="/docs/">
                Read the docs
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
