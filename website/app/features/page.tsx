import Link from 'next/link';
import type { Metadata } from 'next';
import { FEATURES } from '@/lib/features';
import { ProductShot } from '../components/ProductShot';
import type { ProductShotId } from '@/lib/product-shots';

export const metadata: Metadata = {
  title: 'Features',
  description: 'A detailed tour of the cockpit: terminals, agents board, inbox, orchestration, extensions, and more.',
  alternates: { canonical: '/features/' },
  openGraph: {
    title: 'Features — Zana Command Center',
    description: 'A detailed tour of the cockpit: terminals, agents, inbox, orchestration, and extensions.',
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
    <>
      <section className="hero" style={{ padding: '96px 0 24px' }}>
        <div className="wrap">
          <div className="badge-row">
            <span className="eyebrow">Features</span>
          </div>
          <h1 style={{ fontSize: 'clamp(34px,5.4vw,56px)' }}>
            Everything the <span className="grad">cockpit</span> gives you.
          </h1>
          <p className="lede">
            Zana Command Center turns supported coding harnesses into a multi-project fleet. Here is what you
            actually get, grounded in the real app.
          </p>
        </div>
      </section>

      {/* quick jump chips */}
      <div className="wrap" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'center', marginBottom: 24 }}>
        {FEATURES.map((f) => (
          <a
            key={f.slug}
            href={`#${f.slug}`}
            className="btn btn-sm btn-ghost"
            style={{ borderColor: 'var(--border)' }}
          >
            {f.title}
          </a>
        ))}
      </div>

      {FEATURES.map((f, i) => (
        <section key={f.slug} id={f.slug} style={{ paddingTop: 40, paddingBottom: 40 }}>
          <div className="wrap">
              <div className={`product-proof ${i % 2 === 1 ? 'reverse' : ''}`} data-reveal>
                <div>
                <h2>{f.title}</h2>
                <p style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: 12 }}>{f.tagline}</p>
                <p>{f.body}</p>
                {f.docs && (
                  <p style={{ marginTop: 14 }}>
                    <Link className="btn btn-sm btn-ghost" href={`/docs/${f.docs}/`}>
                      Read the docs →
                    </Link>
                  </p>
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

      <section>
        <div className="wrap">
          <div className="cta-strip" data-reveal>
            <span className="eyebrow">Get started</span>
            <h2>Ready to run a fleet?</h2>
            <div className="cta" style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 22 }}>
              <Link className="btn btn-primary btn-lg" href="/download/">
                ⬇ Download
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/marketplace/">
                Browse extensions
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
