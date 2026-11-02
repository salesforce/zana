'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { HelpVideo } from '../../lib/help-videos';
import { helpVideoAssetUrl } from '../../lib/help-video-assets';
import styles from './getting-started.module.css';

export function GettingStarted({ videos }: { videos: HelpVideo[] }) {
  const [selectedId, setSelectedId] = useState(videos[0]?.id);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const selected = videos.find(video => video.id === selectedId) ?? videos[0];

  function select(video: HelpVideo) {
    setSelectedId(video.id);
    setFailed(false);
  }

  return (
    <article className={styles.guide}>
      <header className={styles.intro}>
        <span className="zcc-kicker">Getting started</span>
        <h1>Your first project.<br />Then take it further.</h1>
        <p>Install Zana, open a folder, and give your agent a task. These short videos show you the rest.</p>
      </header>

      <ol className={styles.steps} aria-label="Set up Zana">
        <li><span>01</span><h2>Install Zana</h2><p>Get the app for macOS or Windows.</p><Link href="/download/">Download Zana →</Link></li>
        <li><span>02</span><h2>Add a project</h2><p>Click <strong>Add project</strong> in the sidebar and choose your folder.</p></li>
        <li><span>03</span><h2>Start a thread</h2><p>Open <strong>New Chat</strong>, pick your agent, and describe what you want done.</p></li>
      </ol>

      <details className={styles.requirements}>
        <summary>What do I need installed?</summary>
        <p><a href="https://nodejs.org/">Node.js</a> 20 or newer (22+ recommended), Git, and at least one agent CLI: Claude Code, Cursor, OpenCode, Codex, or Pi. If the CLI runs in your terminal, you can use it in Zana.</p>
        <p>Working on another computer? <Link href="/docs/multiple-devices/">Follow the connection guide</Link> (Node.js 22+ required on remote hosts).</p>
      </details>

      {selected && <section className={styles.watch} aria-labelledby="how-to-heading">
        <h2 id="how-to-heading">Watch and follow along</h2>
        <p>The same How To videos you’ll find inside Zana. Choose one to get started.</p>
        <div className={styles.nowPlaying} aria-live="polite">
          <h3>{selected.title}</h3><span>{selected.duration} · {selected.details}</span>
        </div>
        <video
          key={`${selected.src.path}:${attempt}`}
          className={styles.player}
          controls playsInline preload="none" crossOrigin="anonymous"
          poster={helpVideoAssetUrl(selected.poster)}
          src={helpVideoAssetUrl(selected.src)}
          muted={selected.silent}
          aria-label={selected.title}
          onError={() => setFailed(true)}
        >
          <track kind="captions" src={helpVideoAssetUrl(selected.captions)} srcLang="en" label="English" default />
          <a href={helpVideoAssetUrl(selected.src)}>Open video</a>
        </video>
        {failed && <div className={styles.error} role="alert">
          <span>This video couldn’t load. </span>
          <button type="button" onClick={() => { setFailed(false); setAttempt(attempt + 1); }}>Try again</button>
          {' or '}<a href={helpVideoAssetUrl(selected.src)}>open the video directly</a>.
        </div>}
        <p className={styles.description}>{selected.description}</p>
        <div className={styles.videos} aria-label="How To videos">
          {videos.map(video => <button
            key={video.id} type="button" className={styles.card}
            aria-pressed={selected.id === video.id}
            onClick={() => select(video)}
          >
            <div className={styles.thumbnail}>
              <img src={helpVideoAssetUrl(video.poster)} alt="" loading="lazy" width={640} height={400} />
              <span className={styles.play} aria-hidden="true">▶</span>
              <span className={styles.duration}>{video.duration}</span>
            </div>
            <div className={styles.cardCopy}><span>{video.group}</span><strong>{video.title}</strong></div>
          </button>)}
        </div>
      </section>}
      <footer className={styles.next}>
        <span>Ready to explore?</span>
        <Link href="/docs/using-zana/">Read the full guide <span aria-hidden="true">→</span></Link>
      </footer>
    </article>
  );
}
