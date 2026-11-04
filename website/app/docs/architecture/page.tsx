import type { Metadata } from 'next';
import Link from 'next/link';
import { ArchitectureOverview } from '../../components/BrandStories';
import { site } from '../../../lib/site';

export const metadata: Metadata = {
  title: 'Architecture',
  description: 'How the Zana desktop, product services, and execution hosts fit together.',
  alternates: { canonical: '/docs/architecture/' }
};

export default function ArchitecturePage() {
  return (
    <section className="fairy-section architecture-reference" aria-labelledby="architecture-heading">
      <div className="wrap">
        <p className="fairy-kicker">Architecture</p>
        <h1 id="architecture-heading">How Zana fits together.</h1>
        <ArchitectureOverview />
        <div className="zcc-actions">
          <a className="text-link" href={site.repo}>Explore the source on GitHub →</a>
          <Link className="text-link" href="/docs/">Back to documentation</Link>
        </div>
      </div>
    </section>
  );
}
