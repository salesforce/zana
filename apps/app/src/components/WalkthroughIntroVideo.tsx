import { useEffect, useRef } from 'react';
import { helpVideo } from '../lib/help-videos.js';
import { trackWatched } from './help/help-videos-store.js';

const clip = helpVideo('guided-start');

/**
 * The 30-second "first project" clip that opens the walkthrough: add a folder
 * as a project, pick a harness, get a design doc, preview the build, read the
 * Inbox report. Bundled media only (source: docs/media/guided-start/); Help →
 * Videos lists the same clip and its watched state.
 *
 * Plays muted on its own unless the user prefers reduced motion; the native
 * controls stay available either way.
 */
export function WalkthroughIntroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    ref.current!.play()?.catch(() => {});
  }, []);

  return (
    <video
      ref={ref}
      className="walkthrough-video"
      aria-label="First project walkthrough video"
      data-testid="walkthrough-intro-video"
      controls
      muted
      playsInline
      preload="auto"
      poster={clip.poster}
      onTimeUpdate={trackWatched(clip.id)}
    >
      <source src={clip.src} type="video/mp4" />
      <track kind="captions" src={clip.captions} srcLang="en" label="English" />
    </video>
  );
}
