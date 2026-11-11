import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { site } from '../lib/site';
import { TourVideo } from './components/TourVideo';
import { AgentCityDemo } from './components/AgentCityDemo';
import { AgentArchitecture } from './components/AgentArchitecture';
import styles from './home.module.css';

const ICON = (n: string) => `/walkthrough/icons/${n}`;
const Glyph = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
const PLUGINS = [
  { name: 'Agent City', d: 'M4 21V9l6-3v15M10 21V4l10 5v12M2 21h20M14 12h2M14 16h2' },
  { name: 'Tasks', d: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2' },
  { name: 'Docs', d: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6' },
  { name: 'Workflows', d: 'M5 5h4v4H5zM15 15h4v4h-4zM15 5h4v4h-4zM9 7h6M17 9v6M9 9l6 8' }
];

export const metadata: Metadata = {
  title: 'Zana — Your agents. Your projects. One clear view.',
  description:
    'Run your favorite coding agents, keep work moving across projects, and answer when your judgment is needed. Free and open source for macOS and Windows.',
  alternates: { canonical: '/' },
  openGraph: { url: '/', type: 'website', images: ['/opengraph-image'] }
};

const HARNESSES = [
  { name: 'Claude Code', icon: 'claude-code.svg', mono: false },
  { name: 'Codex', icon: 'codex.svg', mono: true },
  { name: 'Cursor', icon: 'cursor.svg', mono: true },
  { name: 'OpenCode', icon: 'opencode.svg', mono: true },
  { name: 'Pi', icon: 'pi.svg', mono: true },
  { name: 'Grok Build', icon: 'grok.svg', mono: true }
];

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: site.name,
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'macOS, Windows',
            description: site.tagline,
            url: site.publicBaseUrl,
            downloadUrl: `${site.publicBaseUrl}/download/`,
            softwareVersion: site.latestVersion,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }
          })
        }}
      />
      <div className="fairy-home">
        <section className="fairy-hero" aria-labelledby="hero-heading">
          <div className="wrap fairy-hero-grid">
            <div className="fairy-hero-copy">
              <p className="fairy-kicker">
                <span aria-hidden="true">✦</span> Your AI coding command center
              </p>
              <h1 id="hero-heading">
                Your agents.
                <br />
                Your projects.
                <br />
                <span>All together.</span>
              </h1>
              <p className="fairy-lede">
                Run the coding agents you already use. Follow their work across
                projects, and step in when they need you.
              </p>
              <div className="zcc-actions">
                <Link
                  className="zcc-btn zcc-btn-primary zcc-btn-lg"
                  href="/download/"
                >
                  Download Zana
                </Link>
                <a className="fairy-demo-link" href="#demo">
                  <span aria-hidden="true">▷</span> Watch the tour
                </a>
              </div>
              <p className="fairy-hero-note">
                <a href={site.repo}>Free &amp; open source</a><span aria-hidden="true">·</span>macOS
                &amp; Windows
              </p>
            </div>
            <AgentCityDemo />
          </div>
        </section>

        <section
          className={`fairy-providers ${styles.providers}`}
          aria-label="Supported coding agents"
        >
          <div className="wrap">
            <p>
              Your agents.
              <br />
              <strong>Ready to work here.</strong>
            </p>
            <ul>
              {HARNESSES.map((h) => (
                <li key={h.name}>
                  <span className={styles.chipIcon} aria-hidden="true">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className={h.mono ? styles.mono : undefined} src={ICON(h.icon)} alt="" width={20} height={20} />
                  </span>
                  {h.name}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          className="fairy-section fairy-demo-section"
          id="demo"
          aria-labelledby="demo-heading"
        >
          <div className="wrap">
            <div className="fairy-section-heading">
              <div>
                <p className="fairy-kicker">See the real app</p>
                <h2 id="demo-heading">
                  From your first task
                  <br />
                  <span>to the finished work.</span>
                </h2>
              </div>
              <p>
                A 90-second tour of starting a task, following your agents,
                and reviewing the result.
              </p>
            </div>
            <TourVideo />
            <p className="fairy-walkthrough-link"><Link className="text-link" href="/walkthrough/">New to Zana? Take the walkthrough <span aria-hidden="true">→</span></Link></p>
            <ul className={styles.benefits} aria-label="Why use Zana">
              <li className={styles.benefit}>
                <div className={styles.mock} aria-hidden="true">
                  <span className={styles.mockRow}><i className={styles.dotBlue} />zana-app<b>3</b></span>
                  <span className={styles.mockRow}><i className={styles.dotTeal} />api-gateway<b>2</b></span>
                  <span className={styles.mockRow}><i className={styles.dotPink} />docs-site<b>1</b></span>
                </div>
                <span className={styles.bIcon} aria-hidden="true"><Glyph d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></span>
                <h3>Every project in reach.</h3><p>Keep sessions with the project they belong to.</p>
              </li>
              <li className={styles.benefit}>
                <div className={styles.mock} aria-hidden="true">
                  <span className={styles.mockRow}>Refactor auth<em className={styles.pillWork}>Working</em></span>
                  <span className={styles.mockRow}>Write tests<em className={styles.pillIdle}>Idle</em></span>
                  <span className={styles.mockRow}>Pick a schema<em className={styles.pillWait}>Waiting</em></span>
                </div>
                <span className={styles.bIcon} aria-hidden="true"><Glyph d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M10 21a2 2 0 0 0 4 0" /></span>
                <h3>Know what needs you.</h3><p>See working, idle, and waiting agents together.</p>
              </li>
              <li className={styles.benefit}>
                <div className={styles.mock} aria-hidden="true">
                  <span className={styles.bubble}>Use Postgres or SQLite?</span>
                  <span className={styles.reply}>Postgres<span>Send</span></span>
                  <span className={styles.done}>Result ready to review</span>
                </div>
                <span className={styles.bIcon} aria-hidden="true"><Glyph d="M5 12h14M13 6l6 6-6 6" /></span>
                <h3>Keep work moving.</h3><p>Answer a question and return to the result.</p>
              </li>
            </ul>
          </div>
        </section>

        <AgentArchitecture />

        <section className={styles.teaser} aria-labelledby="plugins-heading">
          <div className={`wrap ${styles.teaserCard}`}>
            <div className={styles.teaserCopy}>
              <p className="fairy-kicker lavender">Make it yours</p>
              <h2 id="plugins-heading">There’s a plugin <span>for that.</span></h2>
              <p>Agent City is one of them. Add the tools and views that fit your work.</p>
            </div>
            <div className={styles.plugins} aria-hidden="true">
              {PLUGINS.map((p) => (
                <span key={p.name} className={styles.plugin}>
                  <span className={styles.pluginIcon}><Glyph d={p.d} /></span>
                  {p.name}
                </span>
              ))}
            </div>
            <div className={`zcc-actions ${styles.teaserActions}`}>
              <Link className="zcc-btn zcc-btn-primary" href="/marketplace/">
                Explore plugins <span aria-hidden="true">→</span>
              </Link>
              <Link className="text-link" href="/extensions/getting-started/">Build your own</Link>
            </div>
          </div>
        </section>

        <section className={styles.final} aria-labelledby="final-cta-heading">
          <div className={`wrap ${styles.finalCard}`}>
            <span className={styles.markWrap}><Image
              src="/zana-mark.svg?v=fairy-2"
              alt=""
              width={58}
              height={58}
            /></span>
            <h2 id="final-cta-heading">
              Bring your <span>first project.</span>
            </h2>
            <p>Your agents are ready. Let’s get to work.</p>
            <div className="zcc-actions">
              <Link
                className="zcc-btn zcc-btn-primary zcc-btn-lg"
                href="/download/"
              >
                Download Zana
              </Link>
              <Link
                className="zcc-btn zcc-btn-ghost zcc-btn-lg"
                href="/docs/getting-started/"
              >
                Getting started
              </Link>
            </div>
            <span className={styles.finalNote}>
              Free and open source · macOS (Apple Silicon &amp; Intel) · Windows x64
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
