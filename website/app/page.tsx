import Link from 'next/link';
import type { Metadata } from 'next';
import { site } from '@/lib/site';
import { FEATURES as ALL_FEATURES, LANDING_FEATURE_SLUGS } from '@/lib/features';
import { Fairy } from './components/Fairy';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { url: '/', type: 'website', images: ['/opengraph-image'] }
};

const FEATURES = LANDING_FEATURE_SLUGS.map((slug) => {
  const f = ALL_FEATURES.find((x) => x.slug === slug)!;
  return { slug: f.slug, ico: f.ico, title: f.title, body: f.tagline };
});

const STATS = [
  { num: 'Many', lbl: 'Sessions in parallel' },
  { num: '1', lbl: 'Window for every project' },
  { num: 'macOS', lbl: 'Today — Windows & Linux soon' },
  { num: 'Open', lbl: 'Free & extensible' }
];

// A real (trimmed) renderer-entry snippet — shown as a static showcase in the
// "extend" split. Kept as a plain string so the editor chrome carries the look
// without a full syntax highlighter on the marketing page.
const SDK_SNIPPET = `import type { RendererEntry } from '@zana-ai/zcc-extension-sdk/renderer';

const entry: RendererEntry = {
  activate({ React, host }) {
    // host is your only, permission-gated surface
    return function Panel() {
      return (
        <button onClick={() => host.pushInbox({ comments: 'hi' })}>
          Ping the inbox
        </button>
      );
    };
  },
};

export default entry;`;

const STEPS = [
  {
    n: '1',
    title: 'Add your projects',
    body: 'Point the cockpit at local folders or remote SSH boxes. Each becomes a lane with its own terminals, agents, and file explorer.'
  },
  {
    n: '2',
    title: 'Spawn & orchestrate',
    body: 'Launch Claude Code sessions, curated teams, sprints, or goal-driven autopilot — as many as you need, running in parallel.'
  },
  {
    n: '3',
    title: 'Stay the executive',
    body: 'The inbox surfaces what needs a decision. Reply once and the answer routes straight back to the waiting agent.'
  }
];

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
      {/* SoftwareApplication structured data for rich search results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      {/* HERO — fairy split */}
      <section className="hero hero-fairy">
        <div className="wrap">
          <div className="hero-copy">
            <span className="ornament">
              <span className="glyph" aria-hidden="true">✧</span>&nbsp;&nbsp;A desktop cockpit for Claude&nbsp;Code&nbsp;&nbsp;<span className="glyph" aria-hidden="true">✧</span>
            </span>
            <h1>
              Make the wishes.
              <br />
              <span className="grad">The work gets done.</span>
            </h1>
            <p className="lede">
              Run and orchestrate <strong>many Claude&nbsp;Code sessions</strong> across all your projects — from
              one window. Spawn agents, hand off work, and reply from a single inbox.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/download/">
                ⬇ Download for free
              </Link>
              <Link className="btn btn-ghost btn-lg" href="/marketplace/">
                Explore the marketplace →
              </Link>
            </div>
            <p className="sub">
              <span>macOS today · Windows &amp; Linux soon</span>
              <span className="dot" />
              <span>Free &amp; open</span>
              <span className="dot" />
              <span>Auto-updating</span>
            </p>
          </div>

          <div className="fairy-stage">
            <svg className="fairy-ring" viewBox="0 0 200 200" fill="none" aria-hidden="true">
              <circle cx="100" cy="100" r="96" stroke="currentColor" strokeWidth="0.6" strokeDasharray="1 5" />
              <circle cx="100" cy="100" r="84" stroke="currentColor" strokeWidth="0.4" opacity="0.6" />
              <circle cx="100" cy="100" r="72" stroke="currentColor" strokeWidth="0.4" strokeDasharray="0.5 8" opacity="0.5" />
            </svg>
            <Fairy className="fairy-figure" />
          </div>
        </div>
      </section>

      {/* PRODUCT DEMO */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="mock" data-reveal>
            <div className="mock-bar">
              <span className="tl r" />
              <span className="tl y" />
              <span className="tl g" />
              <span className="title">Zana Command Center</span>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              className="demo"
              src="/demo.gif"
              alt="Zana Command Center orchestrating multiple Claude Code sessions across projects"
              width={1400}
              height={900}
              loading="lazy"
              decoding="async"
            />
          </div>
        </div>
      </section>

      {/* TRUST BAND */}
      <div className="band">
        <div className="wrap">
          <div className="stats" data-reveal-stagger>
            {STATS.map((s) => (
              <div className="stat" key={s.lbl}>
                <div className="num">{s.num}</div>
                <div className="lbl">{s.lbl}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* FEATURE GRID */}
      <section>
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">Why Zana</span>
            <h2>From a single terminal to a cockpit</h2>
            <p className="section-lede">
              Spawn, watch, reply, and drive multi-agent workflows — all from one place, built for people who
              run Claude Code at scale.
            </p>
          </div>
          <div className="grid grid-3" data-reveal-stagger>
            {FEATURES.map((f) => (
              <Link className="card" key={f.title} href={`/features#${f.slug}`}>
                <span className="ico">{f.ico}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </Link>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Link className="btn btn-ghost" href="/features/">
              See every feature in detail →
            </Link>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="section-head center">
            <span className="eyebrow">How it works</span>
            <h2>Three steps to a fleet</h2>
            <p className="section-lede">No new mental model — it&apos;s the Claude Code you know, multiplied.</p>
          </div>
          <div className="steps" data-reveal-stagger>
            {STEPS.map((s) => (
              <div className="step" key={s.n}>
                <div className="n">{s.n}</div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SPLIT 1 — orchestration */}
      <section>
        <div className="wrap">
          <div className="split" data-reveal>
            <div>
              <span className="eyebrow">Orchestration</span>
              <h2>Run a fleet, not a tab</h2>
              <p>
                Group agents by project, spin up curated teams, run sprints and councils, and let autopilot
                pursue a goal — while you stay the executive in the loop.
              </p>
              <ul>
                <li>Per-project agent lanes with live status</li>
                <li>Teams, sprints, and multi-voice deliberation</li>
                <li>Goal-driven autopilot with evaluator loops</li>
                <li>Inbox surfaces exactly what needs your decision</li>
              </ul>
            </div>
            <div className="visual">
              <div className="mock-agent">
                <div className="row"><span className="nm">🧭 architect</span><span className="tag work">working</span></div>
                <div className="line m" />
              </div>
              <div className="mock-agent">
                <div className="row"><span className="nm">🔍 reviewer</span><span className="tag">approved</span></div>
                <div className="line s" />
              </div>
              <div className="mock-agent">
                <div className="row"><span className="nm">⚖️ council</span><span className="tag need">awaiting verdict</span></div>
                <div className="line m" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SPLIT 2 — marketplace */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="split rev" data-reveal>
            <div>
              <span className="eyebrow">Build with the SDK</span>
              <h2>An app you can extend — in TypeScript</h2>
              <p>
                Extensions are plain TypeScript against a stable, versioned contract —{' '}
                <code>@zana-ai/zcc-extension-sdk</code>. A renderer entry returns a React panel; an optional main
                module gets a brokered, permission-gated context (<code>ctx.exec</code>, <code>ctx.fs</code>,{' '}
                <code>ctx.fetch</code>). No core edits, no rebuild of the app.
              </p>
              <ul>
                <li>Contribute panels, tabs, commands, personas &amp; teams</li>
                <li>Capabilities are declared and enforced by a permission broker</li>
                <li>Install from the marketplace, or publish your own via GitHub</li>
              </ul>
              <div style={{ display: 'flex', gap: 12, marginTop: 20, flexWrap: 'wrap' }}>
                <Link className="btn btn-primary" href="/docs/extensions-quickstart/">Build your first extension →</Link>
                <Link className="btn btn-ghost" href="/marketplace/">Browse extensions</Link>
              </div>
            </div>
            <div className="visual" style={{ padding: 0, border: 'none', background: 'none', boxShadow: 'none' }}>
              <div className="code-showcase">
                <div className="cs-bar">
                  <span className="tl r" />
                  <span className="tl y" />
                  <span className="tl g" />
                  <span className="fname">renderer.ts</span>
                </div>
                <pre aria-hidden="true">
                  <code>{SDK_SNIPPET}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA STRIP */}
      <section>
        <div className="wrap">
          <div className="cta-strip" data-reveal>
            <span className="eyebrow">Get started</span>
            <h2>Bring every project into one window.</h2>
            <p className="section-lede" style={{ maxWidth: 520, margin: '0 auto 28px' }}>
              Free, open, and signed. Install in minutes and reopen your Claude Code sessions to light it up.
            </p>
            <div className="cta" style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
              <Link className="btn btn-primary btn-lg" href="/download/">⬇ Download Zana Command Center</Link>
              <Link className="btn btn-ghost btn-lg" href="/docs/">Read the docs</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
