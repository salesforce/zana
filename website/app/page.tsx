import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { site } from '../lib/site';
import { ProductDemo } from './components/product-tour/ProductDemo';
import {
  ArchitectureOverview,
  InboxStory,
  LibraryStory,
  PluginOverview
} from './components/BrandStories';

export const metadata: Metadata = {
  title: 'Zana — Your agents. Your projects. One clear view.',
  description:
    'Run your favorite coding agents, keep work moving across projects, and answer when your judgment is needed. Free and open source for macOS.',
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
const WORKFLOW = [
  [
    '01',
    'Choose your project.',
    'Local repositories, enrolled machines, and SSH projects. Keep the work in context.'
  ],
  [
    '02',
    'Put your agents to work.',
    'Start a Thread or a CLI Agent. Follow every session from one board.'
  ],
  [
    '03',
    'Bring the result home.',
    'Answer questions, review changes, and keep findings for the next task.'
  ]
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
            operatingSystem: 'macOS',
            description: site.tagline,
            url: site.publicBaseUrl,
            downloadUrl: `${site.releasesRepo}/releases/latest`,
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
                <span aria-hidden="true">✦</span> A little magic. A clear view.
              </p>
              <h1 id="hero-heading">
                Your agents.
                <br />
                Your projects.
                <br />
                <span>All together.</span>
              </h1>
              <p className="fairy-lede">
                A command center for your AI coding agents. Keep work moving
                across projects, and answer when your judgment is needed.
              </p>
              <div className="zcc-actions">
                <Link
                  className="zcc-btn zcc-btn-primary zcc-btn-lg"
                  href="/download/"
                >
                  Download for macOS <span aria-hidden="true">↗</span>
                </Link>
                <a className="fairy-demo-link" href="#demo">
                  <span aria-hidden="true">▷</span> See Zana in action
                </a>
              </div>
              <p className="fairy-hero-note">
                Free &amp; open source<span aria-hidden="true">·</span>Your
                tools, your control
              </p>
            </div>
            <div className="fairy-hero-art">
              <Image
                src="/artwork/zana-fairy.svg"
                alt="Zana’s pearl-white Fairy, with blue and lavender wings and a golden spark"
                width={590}
                height={580}
                priority
              />
              <span className="fairy-orbit-label orbit-projects">
                Your projects
              </span>
              <span className="fairy-orbit-label orbit-agents">
                Your agents
              </span>
              <span className="fairy-orbit-label orbit-ideas">
                Your next idea
              </span>
            </div>
          </div>
          <div className="wrap fairy-hero-foot">
            <span>Built for the way you work</span>
            <a href="#demo" aria-label="Explore the product demo">
              Explore Zana <span aria-hidden="true">↓</span>
            </a>
          </div>
        </section>

        <section
          className="fairy-providers"
          aria-label="Supported coding agents"
        >
          <div className="wrap">
            <p>
              The agents you already know.
              <br />
              <strong>A new way to work with them.</strong>
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
                <p className="fairy-kicker">From a task to a result</p>
                <h2 id="demo-heading">
                  Follow the work.
                  <br />
                  <span>Stay in the flow.</span>
                </h2>
              </div>
              <p>
                Start a session, follow its progress, and review what changed.
                Everything stays with the project.
              </p>
            </div>
            <ProductDemo />
          </div>
        </section>

        <section
          className="fairy-section fairy-workflow"
          aria-labelledby="workflow-heading"
        >
          <div className="wrap">
            <p className="fairy-kicker">Many moving parts. One place.</p>
            <h2 id="workflow-heading">
              Room for every project.
              <br />
              <span>A path for every task.</span>
            </h2>
            <ol className="fairy-workflow-grid">
              {WORKFLOW.map(([number, title, body]) => (
                <li key={number}>
                  <span>{number}</span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </li>
              ))}
            </ol>
            <Link className="text-link" href="/features/">
              Explore the product <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        <section
          className="fairy-section fairy-story"
          aria-labelledby="inbox-heading"
        >
          <div className="wrap fairy-split">
            <div className="fairy-story-copy">
              <p className="fairy-kicker gold">Your attention, well spent</p>
              <h2 id="inbox-heading">
                Be there for
                <br />
                <span>the decisions.</span>
              </h2>
              <p>
                Questions come to your Inbox with the context you need. Reply
                once, and send the answer back to the waiting agent.
              </p>
              <Link className="text-link" href="/features/#inbox">
                Meet your Inbox <span aria-hidden="true">→</span>
              </Link>
            </div>
            <InboxStory />
          </div>
        </section>

        <section
          className="fairy-section fairy-story"
          aria-labelledby="library-heading"
        >
          <div className="wrap fairy-split fairy-split-reverse">
            <LibraryStory />
            <div className="fairy-story-copy">
              <p className="fairy-kicker lavender">Good work has a memory</p>
              <h2 id="library-heading">
                Keep the insight.
                <br />
                <span>Build on it.</span>
              </h2>
              <p>
                Give reports, diagrams, and findings a home in your project
                Library. The next task starts with what you already learned.
              </p>
              <Link className="text-link" href="/docs/using-zana/">
                Explore the workflow <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>

        <section
          className="fairy-section fairy-plugin-section"
          aria-labelledby="plugins-heading"
        >
          <div className="wrap fairy-split">
            <div className="fairy-story-copy">
              <p className="fairy-kicker lavender">Built to become yours</p>
              <h2 id="plugins-heading">
                Your workflow.
                <br />
                <span>Your kind of magic.</span>
              </h2>
              <p>
                Add the tools, views, and skills your work calls for. Discover a
                plugin, or build your own with the Zana SDK.
              </p>
              <div className="zcc-actions">
                <Link className="zcc-btn zcc-btn-primary" href="/marketplace/">
                  Find a plugin <span aria-hidden="true">↗</span>
                </Link>
                <Link className="text-link" href="/extensions/">
                  Build a plugin <span aria-hidden="true">→</span>
                </Link>
              </div>
            </div>
            <PluginOverview />
          </div>
        </section>

        <section
          className="fairy-section"
          aria-labelledby="architecture-heading"
        >
          <div className="wrap fairy-split">
            <div className="fairy-story-copy">
              <p className="fairy-kicker">A clear foundation</p>
              <h2 id="architecture-heading">
                A little magic.
                <br />
                <span>Open by design.</span>
              </h2>
              <p>
                See how the desktop, product services, and execution hosts fit
                together. Explore the source and make Zana part of your own way
                of working.
              </p>
              <a className="text-link" href={site.repo}>
                Explore on GitHub <span aria-hidden="true">↗</span>
              </a>
            </div>
            <ArchitectureOverview />
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
            <p className="fairy-kicker">Make room for what comes next</p>
            <h2 id="final-cta-heading">
              Many agents.
              <br />
              <span>One clear view.</span>
            </h2>
            <p>Bring your first project. Let’s get to work.</p>
            <div className="zcc-actions">
              <Link
                className="zcc-btn zcc-btn-primary zcc-btn-lg"
                href="/download/"
              >
                Download for macOS <span aria-hidden="true">↗</span>
              </Link>
              <Link
                className="zcc-btn zcc-btn-ghost zcc-btn-lg"
                href="/docs/getting-started/"
              >
                Getting started
              </Link>
            </div>
            <span className="fairy-final-note">
              Free and open source · Apple Silicon &amp; Intel
            </span>
          </div>
        </section>
      </div>
    </>
  );
}
