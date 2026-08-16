import Link from 'next/link';
import type { Metadata } from 'next';
import { site } from '@/lib/site';
import { FEATURES as ALL_FEATURES, LANDING_FEATURE_SLUGS } from '@/lib/features';
import { Fairy } from './components/Fairy';
import { ProductShot } from './components/ProductShot';
import { HarnessStrip } from './components/HarnessStrip';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { url: '/', type: 'website', images: ['/opengraph-image'] }
};

const FEATURES = LANDING_FEATURE_SLUGS.map((slug) => {
  const f = ALL_FEATURES.find((x) => x.slug === slug)!;
  return { slug: f.slug, title: f.title, body: f.tagline };
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
    title: 'Connect the work',
    body: 'Add local folders or remote SSH projects. Each keeps its own workspace, terminals, agents, and files while staying visible in one cockpit.'
  },
  {
    n: '2',
    title: 'Delegate with context',
    body: 'Launch the coding harness you already use, then give each session a focused outcome. Bring in teams or goals when the work needs parallelism.'
  },
  {
    n: '3',
    title: 'Decide, don’t babysit',
    body: 'The Agents board and Inbox separate active work from decisions that need you. Reply once and your answer routes back to the right session.'
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
                <span className="glyph" aria-hidden="true">✧</span>&nbsp;&nbsp;A control plane for AI coding harnesses&nbsp;&nbsp;<span className="glyph" aria-hidden="true">✧</span>
              </span>
              <h1>
                Make the work visible.
                <br />
                <span className="grad">Keep the momentum.</span>
              </h1>
              <p className="lede">
                Zana turns sessions from <strong>Claude Code, OpenCode, Codex, and Pi into a managed fleet</strong>.
                Launch work across projects, see what is moving, and step in only when a decision needs you.
              </p>
              <div className="cta">
                <Link className="btn btn-primary btn-lg" href="/download/">
                  ⬇ Download for free
                </Link>
                <Link className="btn btn-ghost btn-lg" href="/how-it-works/">
                  See how it works →
                </Link>
              </div>
            <p className="sub">
              <span>macOS today · Windows &amp; Linux soon</span>
              <span className="dot" />
              <span>Free &amp; open</span>
              <span className="dot" />
              <span>Auto-updating</span>
            </p>
            <HarnessStrip />
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

      <section className="workflow-intro" aria-labelledby="workflow-intro-heading">
        <div className="wrap">
          <div className="workflow-intro-grid" data-reveal>
            <div className="workflow-intro-copy">
              <span className="eyebrow">The operating model</span>
              <h2 id="workflow-intro-heading">Your terminals keep working. Zana makes the work legible.</h2>
              <p>
                Zana does not replace your coding harness or turn engineering into a chat dashboard. It gives every
                session a home, a status, and a route back to you when judgment is required.
              </p>
              <Link className="text-link" href="/how-it-works/">
                Take the five-minute product tour <span aria-hidden="true">→</span>
              </Link>
            </div>
            <ol className="workflow-preview" aria-label="Zana workflow">
              <li>
                <span className="workflow-preview-num">01</span>
                <div>
                  <strong>Project context</strong>
                  <span>Local folders and remote workspaces stay organized.</span>
                </div>
              </li>
              <li>
                <span className="workflow-preview-num">02</span>
                <div>
                  <strong>Focused execution</strong>
                  <span>Independent sessions run at the same time.</span>
                </div>
              </li>
              <li>
                <span className="workflow-preview-num">03</span>
                <div>
                  <strong>Human judgment</strong>
                  <span>The inbox brings only the right decisions forward.</span>
                </div>
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* PRODUCT DEMO */}
      <section className="product-hero-shot" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <ProductShot id="cockpit-overview" priority />
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
              Spawn, watch, reply, and drive multi-agent workflows from one place, even when your agents run in
              different supported harnesses.
            </p>
          </div>
          <div className="grid grid-3" data-reveal-stagger>
            {FEATURES.map((f) => (
              <Link className="card" key={f.title} href={`/features#${f.slug}`}>
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
            <h2>From first project to a calmer workday</h2>
            <p className="section-lede">A deliberately small loop: organize context, delegate work, and act on what needs your judgment.</p>
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
          <div className="how-it-works-cta">
            <Link className="btn btn-ghost" href="/how-it-works/">
              Walk through the complete workflow →
            </Link>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="product-proof" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">Operate with context</span>
              <h2>Know what needs you before you open a terminal.</h2>
              <p>
                The Agents board makes parallel work legible. It groups sessions by status across projects, so the
                next useful action is always easier to find than another tab.
              </p>
              <ul>
                <li>See working, idle, done, and needs-you sessions together</li>
                <li>Jump into the exact terminal that needs a decision</li>
                <li>Keep long-running projects visible without interrupting them</li>
              </ul>
              <p style={{ marginTop: 20 }}>
                <Link className="text-link" href="/how-it-works/#first-session">See the operating loop <span aria-hidden="true">→</span></Link>
              </p>
            </div>
            <ProductShot id="agents-board" />
          </div>
        </div>
      </section>

      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="product-proof reverse" data-reveal>
            <div className="product-proof-copy">
              <span className="eyebrow">Keep judgment human</span>
              <h2>Let the Inbox carry the decisions, not the noise.</h2>
              <p>
                Agents can finish analyses, share reports, or pause on a question. The Inbox gives those moments a
                shared home and routes your answer back to the waiting session.
              </p>
              <ul>
                <li>Read the context without hunting through scrollback</li>
                <li>Reply inline to unblock the right agent</li>
                <li>Keep routine automation folded away from high-signal work</li>
              </ul>
            </div>
            <ProductShot id="inbox-decision" />
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
                <Link className="btn btn-primary" href="/extensions/">Build your first extension →</Link>
                <Link className="btn btn-ghost" href="/marketplace/">Browse extensions</Link>
              </div>
            </div>
            <div className="visual code-visual">
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
              Free, open, and signed. Install in minutes, choose your harness, and put your active projects in motion.
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
