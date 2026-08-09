import Link from 'next/link';
import type { Metadata } from 'next';
import { FEATURES } from '@/lib/features';

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
            Zana Command Center turns Claude Code from a single terminal into a multi-project hub. Here is what
            you actually get — grounded in the real app.
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
            <span aria-hidden="true">{f.ico}</span> {f.title}
          </a>
        ))}
      </div>

      {FEATURES.map((f, i) => (
        <section key={f.slug} id={f.slug} style={{ paddingTop: 40, paddingBottom: 40 }}>
          <div className="wrap">
            <div className={`split ${i % 2 === 1 ? 'rev' : ''}`} data-reveal>
              <div>
                <span className="ico" style={{ display: 'inline-grid' }}>
                  {f.ico}
                </span>
                <h2 style={{ marginTop: 14 }}>{f.title}</h2>
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
              <div className="visual">
                <div
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: 'var(--muted-2)',
                    fontWeight: 700,
                    marginBottom: 8
                  }}
                >
                  What you get
                </div>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {f.points.map((p) => (
                    <li
                      key={p}
                      style={{
                        color: 'var(--text-2)',
                        padding: '10px 0 10px 28px',
                        position: 'relative',
                        fontSize: 14.5,
                        borderBottom: '1px solid var(--border-soft)'
                      }}
                    >
                      <span style={{ position: 'absolute', left: 0, top: 10, color: 'var(--accent-3)', fontWeight: 700 }}>✓</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
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
