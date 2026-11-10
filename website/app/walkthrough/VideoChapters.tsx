'use client';

import { useState } from 'react';
import type { WalkthroughVideo } from './videos';
import styles from './walkthrough.module.css';

export function VideoChapters({ videos }: { videos: WalkthroughVideo[] }) {
  const [selectedId, setSelectedId] = useState(videos[0]?.id);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const selected = videos.find(video => video.id === selectedId) ?? videos[0];

  if (!selected) return <p>More videos are on the way. <a href="/docs/getting-started/">Explore the getting started guide →</a></p>;

  return (
    <div className={styles.cinema}>
      <div className={styles.stage}>
        <video
          key={`${selected.src}:${attempt}`}
          className={styles.player}
          controls playsInline preload="none" crossOrigin="anonymous"
          poster={selected.poster}
          src={selected.src}
          muted={selected.silent}
          aria-label={selected.title}
          onError={() => setFailed(true)}
        >
          <track kind="captions" src={selected.captions} srcLang="en" label="English" default />
          <a href={selected.src}>Open video</a>
        </video>
        {failed && <div className={styles.error} role="alert">
          This video couldn’t load.{' '}
          <button type="button" onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>Try again</button>
          {' or '}<a href={selected.src}>open the video directly</a>.
        </div>}
        <div className={styles.caption}>
          <div aria-live="polite" aria-atomic="true">
            <p className={styles.videoMeta}>{selected.chapter} <span aria-hidden="true">/</span> {selected.duration} · {selected.details}</p>
            <h3>{selected.title}</h3>
          </div>
          <p>{selected.description}</p>
        </div>
      </div>
      <div className={styles.playlist}>
        <p className={styles.playlistLabel}>Choose a chapter</p>
        <ol aria-label="Walkthrough videos">
          {videos.map((video, index) => <li key={video.id}>
            <button
              type="button"
              className={styles.chapter}
              aria-pressed={video.id === selected.id}
              onClick={() => { setSelectedId(video.id); setFailed(false); }}
            >
              <span className={styles.chapterNumber} aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <span className={styles.chapterCopy}>
                <span>{video.chapter} <span aria-hidden="true">·</span> {video.duration}</span>
                <strong>{video.title}</strong>
              </span>
              <span className={styles.chapterPlay} aria-hidden="true">▷</span>
            </button>
          </li>)}
        </ol>
        <p className={styles.playlistNote}>Short recordings. Real work.<br />English captions on every video.</p>
      </div>
    </div>
  );
}
