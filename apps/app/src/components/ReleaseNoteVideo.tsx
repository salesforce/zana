import { helpVideo } from '../lib/help-videos.js';
import { trackWatched } from './help/help-videos-store.js';
import './ReleaseNoteVideo.css';

/** Curated, bundled media only: release Markdown cannot supply a video URL. */
export function ReleaseNoteVideo({ version }: { version: string }) {
  if (version !== '2.3.0') return null;
  const clip = helpVideo('zana-everywhere');

  return (
    <figure className="release-note-video">
      <figcaption>
        <h2>Use Zana everywhere</h2>
        <p>Connect your desktop, then open your Zana address in Safari on your iPhone.</p>
      </figcaption>
      <video aria-label="Use Zana everywhere walkthrough" controls playsInline preload="none" poster={clip.poster} onTimeUpdate={trackWatched(clip.id)}>
        <source src={clip.src} type="video/mp4" />
        <track kind="captions" src={clip.captions} srcLang="en" label="English" />
        Your browser does not support video playback.
      </video>
      <div className="release-note-video-details">
        <span>64 seconds · English voiceover and captions</span>
        <a href={clip.src} download={clip.fileName}>Save video</a>
      </div>
    </figure>
  );
}
