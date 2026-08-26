import Link from 'next/link';
import type { Metadata } from 'next';
import { ProductShot } from '../components/ProductShot';

export const metadata: Metadata = {
  title: 'How it works',
  description:
    'A practical tour of how Zana Command Center organizes projects, runs supported coding harnesses in parallel, and brings decisions back to you.',
  alternates: { canonical: '/how-it-works/' },
  openGraph: {
    title: 'How Zana Command Center works',
    description: 'Organize projects, delegate through your preferred coding harness, and stay in control of the decisions.',
    url: '/how-it-works/',
    type: 'website',
    images: ['/opengraph-image']
  }
};

const JOURNEY = [
  {
    step: '01',
    eyebrow: 'Start with real context',
    title: 'Give every project a place to work.',
    body:
      'Add a local folder, an enrolled machine, or a remote SSH workspace. Zana keeps its terminals, files, and agents together so you can change projects without losing the thread.',
    details: ['Use the same project directory your coding tools expect', 'Pair another computer from Settings → Machines', 'Organize a large project list by category'],
    visual: 'project-setup'
  },
  {
    step: '02',
    eyebrow: 'Launch with intent',
    title: 'Delegate outcomes, not your attention.',
    body:
      'Open a real Claude Code, OpenCode, Codex, or Pi session in the correct project and give it a focused task. Start more sessions when work can proceed independently, without giving up visibility.',
    details: ['Every tab is a real terminal session', 'Run several projects in parallel', 'Use personas and teams for repeatable roles'],
    visual: 'agent-terminal'
  },
  {
    step: '03',
    eyebrow: 'Operate the fleet',
    title: 'See progress without reading every terminal.',
    body:
      'The Agents board groups sessions by state: working, idle, done, or waiting on you. Jump directly to the task that deserves attention instead of hunting through tabs.',
    details: ['A global view across every project', 'Clear status makes blocked work obvious', 'Take over any terminal in one click'],
    visual: 'agents-board'
  },
  {
    step: '04',
    eyebrow: 'Keep human judgment central',
    title: 'Let the Inbox carry the decisions.',
    body:
      'Agents surface reports, questions, and blocked decisions in one place. Read the context, reply inline, and Zana sends your answer back to the waiting session.',
    details: ['Questions, reports, and follow-ups share one feed', 'Reply without finding the original terminal', 'Routine events stay folded away from high-signal work'],
    visual: 'inbox-decision'
  }
] as const;

export default function HowItWorksPage() {
  return (
    <>
      <section className="journey-hero">
        <div className="wrap">
          <div className="journey-hero-copy" data-reveal>
            <span className="eyebrow">A practical product tour</span>
            <h1>More work in motion.<br /><span className="grad">Less work to chase.</span></h1>
            <p>
              Zana keeps the native harness workflow you trust, then adds the operating layer a growing set of
              sessions needs: context, visibility, and a clear path for decisions.
            </p>
            <div className="cta">
              <Link className="btn btn-primary btn-lg" href="/download/">⬇ Download Zana</Link>
              <a className="btn btn-ghost btn-lg" href="#first-session">Start the tour <span aria-hidden="true">↓</span></a>
            </div>
          </div>
          <div className="journey-hero-summary" data-reveal>
            <span>THE ZANA LOOP</span>
            <ol>
              <li><b>1</b><span>Set project context</span></li>
              <li><b>2</b><span>Delegate focused work</span></li>
              <li><b>3</b><span>Monitor the fleet</span></li>
              <li><b>4</b><span>Make the decisions</span></li>
            </ol>
            <p>Built around real harness terminals, not a replacement for them.</p>
          </div>
        </div>
      </section>

      <section className="journey-principles" aria-label="What Zana changes">
        <div className="wrap">
          <div data-reveal>
            <span>Keep your tools</span>
            <strong>Real harness sessions</strong>
          </div>
          <div data-reveal>
            <span>Gain visibility</span>
            <strong>One view across projects</strong>
          </div>
          <div data-reveal>
            <span>Stay accountable</span>
            <strong>You make the calls</strong>
          </div>
        </div>
      </section>

      <section className="journey-section" id="first-session">
        <div className="wrap">
          <div className="journey-section-head" data-reveal>
            <span className="eyebrow">The workflow, step by step</span>
            <h2>Built for the moment one terminal stops being enough.</h2>
            <p>Each stage adds structure without hiding the native harness workflow you already know.</p>
          </div>
          <div className="journey-list">
            {JOURNEY.map((item, index) => (
              <article className={`journey-row ${index % 2 === 1 ? 'reverse' : ''}`} key={item.step} data-reveal>
                <div className="journey-copy">
                  <span className="journey-step">{item.step}</span>
                  <span className="journey-eyebrow">{item.eyebrow}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <ul>
                    {item.details.map((detail) => <li key={detail}>{detail}</li>)}
                  </ul>
                </div>
                <ProductShot id={item.visual} />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="journey-next">
        <div className="wrap">
          <div className="journey-next-card" data-reveal>
            <div>
              <span className="eyebrow">Your first day</span>
              <h2>Start small. Keep the system ready to grow.</h2>
              <p>Add one project, launch one agent, and use the Inbox when it needs you. When parallel work becomes useful, Zana is already organized for it.</p>
            </div>
            <div className="journey-next-actions">
              <Link className="btn btn-primary btn-lg" href="/download/">⬇ Get Zana</Link>
              <Link className="btn btn-ghost" href="/docs/getting-started/">Read the setup guide <span aria-hidden="true">→</span></Link>
              <Link className="text-link" href="/features/">Explore all product capabilities <span aria-hidden="true">→</span></Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
