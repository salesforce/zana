import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { site } from '../lib/site';
import { TourVideo } from './components/TourVideo';
import { AgentCityDemo } from './components/AgentCityDemo';

export const metadata: Metadata = {
  title: 'Zana — Your agents. Your projects. One clear view.',
  description:
    'Run your favorite coding agents, keep work moving across projects, and answer when your judgment is needed. Free and open source for macOS and Windows.',
  alternates: { canonical: '/' },
  openGraph: { url: '/', type: 'website', images: ['/opengraph-image'] }
};

const HARNESSES = [
  'Claude Code',
  'Codex',
  'Cursor',
  'OpenCode',
  'Pi',
  'Grok Build'
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
          className="fairy-providers"
          aria-label="Supported coding agents"
        >
          <div className="wrap">
            <p>
              Your agents.
              <br />
              <strong>Ready to work here.</strong>
            </p>
            <ul>
              {HARNESSES.map((name) => (
                <li key={name}>{name}</li>
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
                A two-minute tour of starting a task, following your agents,
                and reviewing the result.
              </p>
            </div>
            <TourVideo />
            <ul className="fairy-benefits" aria-label="Why use Zana">
              <li><h3>Every project in reach.</h3><p>Keep sessions with the project they belong to.</p></li>
              <li><h3>Know what needs you.</h3><p>See working, idle, and waiting agents together.</p></li>
              <li><h3>Keep work moving.</h3><p>Answer a question and return to the result.</p></li>
            </ul>
          </div>
        </section>

        <section className="fairy-plugin-teaser" aria-labelledby="plugins-heading">
          <div className="wrap">
            <div>
              <p className="fairy-kicker lavender">Make it yours</p>
              <h2 id="plugins-heading">There’s a plugin for that.</h2>
              <p>Agent City is one of them. Add the tools and views that fit your work.</p>
            </div>
            <div className="zcc-actions">
              <Link className="zcc-btn zcc-btn-primary" href="/marketplace/">
                Explore plugins <span aria-hidden="true">→</span>
              </Link>
              <Link className="text-link" href="/extensions/getting-started/">Build your own</Link>
            </div>
          </div>
        </section>

        <section className="fairy-final" aria-labelledby="final-cta-heading">
          <div className="wrap">
            <Image
              src="/zana-mark.svg?v=fairy-2"
              alt=""
              width={58}
              height={58}
            />
            <h2 id="final-cta-heading">
              Bring your first project.
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
            <span className="fairy-final-note">
              Free and open source · macOS (Apple Silicon &amp; Intel) · Windows x64
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
