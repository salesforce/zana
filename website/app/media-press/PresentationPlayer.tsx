'use client';

import Image from 'next/image';
import { useState } from 'react';
import styles from './media-press.module.css';

export function PresentationPlayer() {
  const [playing, setPlaying] = useState(false);

  return (
    <div className={styles.player}>
      {playing ? (
        <iframe
          src="/media/presentations/zana.html#1"
          title="Zana — One workspace for every AI agent — presentation"
          allowFullScreen
          onLoad={(event) => event.currentTarget.focus()}
        />
      ) : (
        <button className={styles.play} onClick={() => setPlaying(true)} aria-label="Play the Zana presentation">
          <Image src="/media/presentations/zana-cover.webp" alt="One workspace for every AI agent — the original Zana presentation" width={1600} height={900} priority />
          <span className={styles.playLabel}><span className={styles.playIcon} aria-hidden="true">▷</span> Explore the presentation</span>
        </button>
      )}
    </div>
  );
}
