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
      'Explore the Agents board, Threads, CLI Agents, Inbox, Plugins, and remote Projects.',
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
          <h1 id="features-heading">A clear view of the work.</h1>
          <p>
            Start a task, follow your agents, and bring the results together. Explore the views that keep your projects moving.
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
              Bring your coding agents and your first project. Keep the work, decisions, and results together.
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
