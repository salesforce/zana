import Link from 'next/link';
import type { Metadata } from 'next';
import { FEATURES } from '@/lib/features';
import { ProductShot } from '../components/ProductShot';
import type { ProductShotId } from '@/lib/product-shots';

export const metadata: Metadata = {
  title: 'Features',
  description: 'A detailed tour of the cockpit: terminals, agents board, inbox, orchestration, plugins, and more.',
  alternates: { canonical: '/features/' },
  openGraph: {
    title: 'Features — Zana Command Center',
    description: 'A detailed tour of the cockpit: terminals, agents, inbox, orchestration, and plugins.',
    url: '/features/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

const FEATURE_SHOTS: Partial<Record<string, ProductShotId>> = {
  cockpit: 'cockpit-overview',
  'agents-board': 'agents-board',
  inbox: 'inbox-decision',
  orchestration: 'team-launch',
  projects: 'project-setup',
  scheduler: 'goal-or-ticket',
  extensions: 'extension-panel-result'
};

export default function Features() {
  return (
    <div className="clean-features-page">
      <section className="clean-page-hero">
        <div className="wrap">
          <span className="clean-page-kicker">Features</span>
          <h1>Everything the cockpit gives you.</h1>
          <p>
            Zana Command Center turns supported coding harnesses into a multi-project fleet. Here is what you
            actually get, grounded in the real app.
          </p>
        </div>
      </section>

      {/* quick jump chips */}
      <div className="wrap clean-feature-nav">
        {FEATURES.map((f) => (
          <a
            key={f.slug}
            href={`#${f.slug}`}
            className="clean-feature-link"
          >
            {f.title}
          </a>
        ))}
      </div>

      {FEATURES.map((f, i) => (
        <section key={f.slug} id={f.slug} className="clean-feature-section">
          <div className="wrap">
            <div className={`product-proof ${i % 2 === 1 ? 'reverse' : ''}`} data-reveal>
              <div className="clean-feature-copy">
                <span className="clean-feature-number">0{i + 1}</span>
                <h2>{f.title}</h2>
                <p className="clean-feature-tagline">{f.tagline}</p>
                <p className="clean-feature-body">{f.body}</p>
                {f.docs && (
                  <Link className="clean-inline-link" href={`/docs/${f.docs}/`}>
                    Read the docs <span aria-hidden="true">→</span>
                  </Link>
                )}
              </div>
                {(() => {
                  const shotId = FEATURE_SHOTS[f.slug];
                  return shotId ? <ProductShot id={shotId} /> : null;
                })()}
              </div>
          </div>
        </section>
      ))}

      <section className="clean-page-cta-section">
        <div className="wrap">
          <div className="clean-page-cta" data-reveal>
            <span className="clean-page-kicker">Get started</span>
            <h2>Ready to run a fleet?</h2>
            <p>Start with the desktop app, then extend the workspace as your process grows.</p>
            <div className="clean-page-actions">
              <Link className="clean-button clean-button-dark" href="/download/">Download for macOS <span aria-hidden="true">→</span></Link>
              <Link className="clean-button" href="/marketplace/">Browse plugins</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
