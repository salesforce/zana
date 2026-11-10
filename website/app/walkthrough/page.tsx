import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { loadHelpVideos } from '../../lib/help-videos';
import { site } from '../../lib/site';
import { VideoChapters } from './VideoChapters';
import { walkthroughVideos } from './videos';
import { AgentConstellation } from './AgentConstellation';
import styles from './walkthrough.module.css';

const description = 'One workspace for every AI agent. See how Zana brings your projects, agents, and tools together, then get started with short videos and real app demos.';

export const metadata: Metadata = {
  title: 'Walkthrough',
  description,
  alternates: { canonical: '/walkthrough/' },
  openGraph: { title: 'The Zana walkthrough', description, url: '/walkthrough/', type: 'website', images: ['/opengraph-image'] }
};

export default async function WalkthroughPage() {
  const videos = walkthroughVideos(await loadHelpVideos());
  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={`wrap ${styles.heroGrid}`}>
          <div>
            <p className="fairy-kicker">The Zana walkthrough</p>
            <h1>Every agent. <span>One workspace.</span></h1>
            <p className={styles.lede}>Zana brings your AI agents, projects, and tools into one desktop app. Choose the agent for the task, follow the work, and step in when your judgment matters.</p>
            <div className={`zcc-actions ${styles.heroActions}`}>
              <a className="zcc-btn zcc-btn-primary" href="#watch"><span aria-hidden="true">▷</span> Watch the overview</a>
              <a className={styles.textLink} href="#first-project">Start your first project <span aria-hidden="true">↓</span></a>
            </div>
            <p className={styles.heroNote}><a href={site.repo}>Free &amp; open source</a><span aria-hidden="true">·</span>macOS &amp; Windows</p>
          </div>
        </div>
      </header>

      <AgentConstellation />

      <div className="wrap">
        <nav className={styles.chapters} aria-label="In this walkthrough">
          <a href="#what-changes"><span>01</span> What changes <span aria-hidden="true">↓</span></a>
          <a href="#watch"><span>02</span> Watch it work <span aria-hidden="true">↓</span></a>
          <a href="#first-project"><span>03</span> Get started <span aria-hidden="true">↓</span></a>
          <a href="#why-zana"><span>04</span> Go further <span aria-hidden="true">↓</span></a>
        </nav>

        <section id="what-changes" className={styles.section} aria-labelledby="changes-heading">
          <div className={styles.sectionHeading}>
            <div><p className="fairy-kicker">Why bring it together?</p><h2 id="changes-heading">Less keeping up.<br />More moving forward.</h2></div>
            <p>Different agents bring different strengths. Zana gives them a shared home, so you can focus on the work.</p>
          </div>
          <table className={styles.comparison}>
            <caption className="sr-only">Working across separate tools compared with using Zana</caption>
            <thead><tr><th scope="col">Today</th><th scope="col">With Zana</th></tr></thead>
            <tbody>
              <tr><td>Sessions spread across terminals and tabs</td><td>Agents and projects together in one place</td></tr>
              <tr><td>Checking every session for an update</td><td>A clear view of what needs your attention</td></tr>
              <tr><td>Useful tools stay with the person who built them</td><td>Team capabilities, built once and shared as plugins</td></tr>
              <tr><td>Results buried in conversation history</td><td>Readable reports delivered to your Inbox</td></tr>
            </tbody>
          </table>
        </section>

        <section id="watch" className={styles.watch} aria-labelledby="watch-heading">
          <div className={styles.sectionHeading}>
            <div><p className="fairy-kicker">See it for yourself</p><h2 id="watch-heading">From the first prompt<br />to the finished work.</h2></div>
            <p>Start with the 90-second overview. Then explore first steps, Squads, remote access, and Agentforce in the real app.</p>
          </div>
          <VideoChapters videos={videos} />
        </section>

        <section id="first-project" className={styles.section} aria-labelledby="start-heading">
          <div className={styles.sectionHeading}>
            <div><p className="fairy-kicker">Your first five minutes</p><h2 id="start-heading">Bring a project.<br />Give it a first task.</h2></div>
            <p>Use the agent you already know. Zana gives it a place to work, and gives you a clear view of what happens next.</p>
          </div>
          <ol className={styles.steps} aria-label="Start using Zana">
            <li><span className={styles.eyebrow}>01 / Install</span><h3>Make yourself at home.</h3><p>Download Zana for macOS or Windows. Have your preferred coding agent CLI installed and signed in.</p><Link className={styles.textLink} href="/download/">Get Zana <span aria-hidden="true">→</span></Link></li>
            <li><span className={styles.eyebrow}>02 / Add a project</span><h3>It starts with a folder.</h3><p>Click <strong>Add project</strong> in the sidebar and choose your folder. Your conversations and work stay with that project.</p></li>
            <li><span className={styles.eyebrow}>03 / Start a thread</span><h3>Ask for something useful.</h3><p>Open <strong>New Chat</strong>, choose an agent, and describe your task. Follow along, answer questions, and review the result.</p></li>
          </ol>
          <div className={styles.prompt}>
            <div><span className={styles.eyebrow}>Try a first prompt</span><p>“Explore this project and explain how it works. Suggest one small improvement.”</p></div>
            <Link className={styles.textLink} href="/docs/getting-started/">Setup details <span aria-hidden="true">↗</span></Link>
          </div>
        </section>

        <section id="why-zana" className={styles.section} aria-labelledby="why-heading">
          <div className={styles.sectionHeading}>
            <div><p className="fairy-kicker lavender">What makes it Zana</p><h2 id="why-heading">One place to direct the work.<br />More ways to get it done.</h2></div>
            <p>From a single conversation to a team of agents, keep the goal, the decisions, and the outcome in view.</p>
          </div>
          <article className={styles.productStory}>
            <div className={styles.storyCopy}><span className={styles.eyebrow}>01 / Your choice of agent</span><h3>Change the agent.<br />Keep your flow.</h3><p>Use Claude Code, Codex, Cursor, OpenCode, or Pi in the same interface. Keep the conversation beside the files, changes, and previews you’re reviewing.</p><p>Your projects stay organized as you choose the right agent for each task.</p><Link className={styles.textLink} href="/features/#thread">Explore threads <span aria-hidden="true">→</span></Link></div>
            <figure className={styles.productShot}><Image src="/walkthrough/thread-preview.jpg" alt="Zana thread building an Atlas pricing page, with the finished page preview beside the conversation" width={1440} height={900} sizes="(max-width: 820px) 92vw, 62vw" /><figcaption>From the overview · A result you can see beside the conversation</figcaption></figure>
          </article>
          <article id="squads" className={`${styles.productStory} ${styles.reverseStory}`}>
            <div className={styles.storyCopy}><span className={styles.eyebrow}>02 / Bigger goals, together</span><h3>Give an objective.<br />Get a team.</h3><p>A Squad turns a goal into a plan and shares the work across agents. Follow the handoffs, answer questions, and review what the team delivers.</p><ol className={styles.handoffs} aria-label="Squad workflow"><li>Plan</li><li>Build</li><li>Review</li></ol><Link className={styles.textLink} href="/docs/using-zana/#squads">Discover Squads <span aria-hidden="true">→</span></Link></div>
            <figure className={styles.productShot}><Image src="/walkthrough/squad-flow.jpg" alt="Zana Squad flow showing an orchestrator, two workers, and a code reviewer on the Atlas project" width={1440} height={900} sizes="(max-width: 820px) 92vw, 62vw" /><figcaption>From the overview · The team and its handoffs, in one view</figcaption></figure>
          </article>
          <div className={styles.strengths}>
            <article><span className={styles.eyebrow}>03 / Attention where it counts</span><h3>Agents report outcomes.<br />You make the decisions.</h3><p>See which agents are working, waiting, or done across projects. Your Inbox brings together questions and readable reports from agents and scheduled work.</p><figure className={styles.reportExample}><figcaption>Example report <span>Ready for review</span></figcaption><strong>The pricing page is ready.</strong><p>Three plans built. Layout checked.<br />Next step: review the page and choose what to ship.</p></figure><Link className={styles.textLink} href="/features/#inbox">Meet your Inbox <span aria-hidden="true">→</span></Link></article>
            <article id="shared-tools"><span className={styles.eyebrow}>04 / Built once, shared with your team</span><h3>Your tools.<br />Part of the conversation.</h3><p>Add capabilities through plugins, from pull request monitoring to Salesforce development. Build a tool for your team and share it through a catalogue.</p><div className={styles.pluginExamples} aria-label="Example plugin capabilities"><span><i aria-hidden="true">↗</i>PR Monitor</span><span><i aria-hidden="true">✦</i>Agentforce Studio</span><span><i aria-hidden="true">＋</i>Your team’s tools</span></div><Link className={styles.textLink} href="/marketplace/">Explore the marketplace <span aria-hidden="true">→</span></Link></article>
          </div>
          <div className={styles.principles}>
            <div><strong>Local or remote.</strong><p>Work on your computer or connect a remote machine.</p></div>
            <div><strong>Your tools and accounts.</strong><p>Keep using the coding agents you already work with.</p></div>
            <div><strong>Your judgment at the center.</strong><p>Review plans, answer questions, and inspect the result.</p></div>
          </div>
        </section>

        <section className={styles.next} aria-labelledby="next-heading">
          <Image src="/zana-mark.svg?v=fairy-2" alt="" width={52} height={52} />
          <p className="fairy-kicker">Your next step</p>
          <h2 id="next-heading">Every agent. One place.</h2>
          <p>Bring your first project. Let’s get to work.</p>
          <div className="zcc-actions"><Link className="zcc-btn zcc-btn-primary zcc-btn-lg" href="/download/">Download Zana</Link><Link className="zcc-btn zcc-btn-ghost zcc-btn-lg" href="/features/">Explore all features <span aria-hidden="true">→</span></Link></div>
          <p className={styles.nextNote}>Free and open source · macOS &amp; Windows</p>
        </section>
      </div>
    </div>
  );
}
