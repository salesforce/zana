import Link from 'next/link';
import type { Metadata } from 'next';
import { site } from '@/lib/site';
import { ProductShot } from './components/ProductShot';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { url: '/', type: 'website', images: ['/opengraph-image'] }
};

const WORKFLOW = [
  {
    n: '01',
    title: 'Give work a home',
    body: 'Add local folders, enrolled machines, or SSH projects. Every project keeps its terminals, files, sessions, and settings together.'
  },
  {
    n: '02',
    title: 'Launch the right crew',
    body: 'Start a Thread from New Chat with Claude Code, Cursor, OpenCode, Codex, Pi, or a shell. Use personas, teams, or Autonomous Team when work benefits from parallel effort.'
  },
  {
    n: '03',
    title: 'Return when it matters',
    body: 'The Agents board and Inbox distinguish ongoing work from results, questions, and decisions that require your judgment.'
  }
];

const HARNESSES = ['Claude Code', 'Cursor', 'OpenCode', 'Codex', 'Pi', 'Shell'];

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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
      />

      <section className="bb-hero" aria-labelledby="hero-heading">
        <div className="wrap bb-hero-copy">
          <p className="bb-kicker">Zana Command Center <span>beta</span></p>
          <h1 id="hero-heading">The desktop command center for your AI coding agents.</h1>
          <p className="bb-lede">
            Run the harnesses you already use across every project. See the work in motion, coordinate a fleet,
            and come back only when your judgment is needed.
          </p>
          <div className="bb-actions">
            <Link className="bb-button bb-button-primary" href="/download/">
              Download for macOS <span aria-hidden="true">&#8594;</span>
            </Link>
            <a className="bb-button bb-button-secondary" href={site.repo} target="_blank" rel="noopener noreferrer">
              View source <span aria-hidden="true">&#8599;</span>
            </a>
          </div>
          <p className="bb-install-note">Free and open source. macOS today; Windows and Linux are next.</p>
        </div>
        <div className="wrap bb-product-wrap">
          <ProductShot id="cockpit-overview" priority frame={false} className="bb-product-shot" />
          <div className="bb-product-glow" aria-hidden="true" />
        </div>
      </section>

      <section className="bb-harnesses" aria-label="Supported coding harnesses">
        <div className="wrap">
          <p>One control plane, your preferred agent</p>
          <ul>
            {HARNESSES.map((harness) => (
              <li key={harness}>{harness}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bb-statement" aria-labelledby="statement-heading">
        <div className="wrap">
          <p className="bb-section-label">A calmer way to run agent work</p>
          <h2 id="statement-heading">Stop managing terminal tabs. Start managing outcomes.</h2>
          <p>
            Zana gives each task a project, each agent a visible state, and every important result a route back to
            the person responsible for the next decision.
          </p>
        </div>
      </section>

      <section className="bb-features" aria-label="Core capabilities">
        <div className="wrap bb-feature-grid" data-reveal-stagger>
          <article className="bb-feature-card bb-feature-card-wide">
            <span className="bb-feature-index">01</span>
            <h2>One place for work that spans projects.</h2>
            <p>
              Move between local folders, enrolled machines, and remote SSH workspaces without losing the context behind a terminal,
              agent, or report.
            </p>
            <div className="bb-project-pills" aria-hidden="true">
              <span><i /> commerce-web</span>
              <span><i /> mobile-app</span>
              <span><i /> platform-api</span>
            </div>
          </article>
          <article className="bb-feature-card">
            <span className="bb-feature-index">02</span>
            <h2>Know the state of every agent.</h2>
            <p>Working, waiting, idle, or complete. The board makes parallel work readable before you open a tab.</p>
            <div className="bb-state-list" aria-hidden="true">
              <span><b className="bb-state-live" /> Working <em>6</em></span>
              <span><b className="bb-state-attention" /> Needs you <em>2</em></span>
              <span><b className="bb-state-done" /> Complete <em>14</em></span>
            </div>
          </article>
          <article className="bb-feature-card">
            <span className="bb-feature-index">03</span>
            <h2>Keep people in the loop, not in the scrollback.</h2>
            <p>Agents can surface reports and questions in one Inbox. Answer once and route the decision to the right session.</p>
            <Link href="/how-it-works/" className="bb-text-link">See the operating loop <span aria-hidden="true">&#8594;</span></Link>
          </article>
        </div>
      </section>

      <section className="bb-workflow" aria-labelledby="workflow-heading">
        <div className="wrap">
          <div className="bb-workflow-heading">
            <p className="bb-section-label">From task to decision</p>
            <h2 id="workflow-heading">A workspace that keeps work moving.</h2>
          </div>
          <ol className="bb-workflow-steps" data-reveal-stagger>
            {WORKFLOW.map((step) => (
              <li key={step.n}>
                <span>{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bb-build" aria-labelledby="build-heading">
        <div className="wrap">
          <div className="bb-build-grid" data-reveal>
            <div>
              <p className="bb-section-label">Built to be extended</p>
              <h2 id="build-heading">Make Zana fit the way your team works.</h2>
              <p>
                Install capabilities from the marketplace or build a TypeScript plugin with panels, project tabs,
                skills, and MCP servers. Plugins are full-trust after a loud install confirm.
              </p>
              <div className="bb-actions">
                <Link className="bb-button bb-button-primary" href="/extensions/">Build a plugin <span aria-hidden="true">&#8594;</span></Link>
                <Link className="bb-button bb-button-secondary" href="/marketplace/">Browse marketplace</Link>
              </div>
            </div>
            <pre className="bb-code-window" aria-label="Example Zana plugin definition"><code><span className="bb-code-muted">package.json</span>{'\n'}{'{'}{'\n'}  <span className="bb-code-key">"name"</span>: <span className="bb-code-value">"zcc-plugin-team-tools"</span>,{'\n'}  <span className="bb-code-key">"zcc"</span>: {'{'} <span className="bb-code-key">"name"</span>: <span className="bb-code-value">"Team tools"</span>, <span className="bb-code-key">"app"</span>: <span className="bb-code-value">"./app.tsx"</span> {'}'}{'\n'}{'}'}</code></pre>
          </div>
        </div>
      </section>

      <section className="bb-final-cta" aria-labelledby="final-cta-heading">
        <div className="wrap">
          <div className="bb-final-cta-card" data-reveal>
            <p className="bb-section-label">Zana Command Center</p>
            <h2 id="final-cta-heading">Keep every agent, project, and decision in view.</h2>
            <p>Download the free desktop app and turn the terminals you already trust into an operating system for agent work.</p>
            <div className="bb-actions">
              <Link className="bb-button bb-button-primary" href="/download/">Download for macOS <span aria-hidden="true">&#8594;</span></Link>
              <Link className="bb-button bb-button-secondary" href="/docs/">Read the docs</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
