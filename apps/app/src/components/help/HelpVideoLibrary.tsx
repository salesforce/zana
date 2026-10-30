import { useEffect, useRef, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { HELP_VIDEOS } from '../../lib/help-videos.js';
import { Modal } from '../Modal.js';
import { trackWatched, useHelpVideos } from './help-videos-store.js';
import './help-menu.css';

/** Help → Videos: a player and the live catalogue, with bundled offline basics. */
export function HelpVideoLibrary() {
  const openId = useHelpVideos((s) => s.openId);
  if (!openId) return null;
  return <Library current={openId} />;
}

function Library({ current }: { current: string }) {
  const { open, close, watched, videos } = useHelpVideos();
  const selected = videos.find(entry => entry.id === current) ?? HELP_VIDEOS[0];
  // Pin the playing cut while a background refresh changes metadata or ordering.
  const selection = useRef({ id: current, video: selected });
  if (selection.current.id !== current) selection.current = { id: current, video: selected };
  const [failed, setFailed] = useState<string | null>(null);
  const original = selection.current.video;
  const fallback = HELP_VIDEOS.find(entry => entry.id === current);
  const video = failed === original.src && fallback ? fallback : original;
  const player = useRef<HTMLVideoElement>(null);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const groups = [...new Set(videos.map((entry) => entry.group))];

  useEffect(() => {
    const element = player.current;
    if (!element) return;
    // Opening a clip is the request to play it; reduced motion keeps it paused.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    element.play()?.catch(() => {});
  }, [current, video.src]);

  useEffect(() => {
    let wasFullscreen = false;
    const restoreFocus = () => {
      if (document.fullscreenElement === player.current) wasFullscreen = true;
      else if (wasFullscreen) {
        wasFullscreen = false;
        fullscreenButton.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('fullscreenchange', restoreFocus);
    return () => document.removeEventListener('fullscreenchange', restoreFocus);
  }, []);

  return (
    <Modal title="Videos" onClose={close} className="help-videos-modal">
      <div className="help-videos" data-testid="help-video-library">
        <div className="help-videos-player">
          <video key={video.src} ref={player} aria-label={video.title} data-testid="help-video-player" controls playsInline
            muted={video.silent} preload="auto" poster={video.poster} onTimeUpdate={trackWatched(video.id)} onError={() => setFailed(original.src)}>
            <source src={video.src} type="video/mp4" onError={() => setFailed(original.src)} />
            <track kind="captions" src={video.captions} srcLang="en" label="English" />
            Your browser does not support video playback.
          </video>
          {failed === original.src && <p role="status">
            {fallback && fallback.src !== original.src ? 'Playing the offline copy. ' : 'This video is unavailable. Check your connection and try again. '}
            <button type="button" onClick={() => { setFailed(null); player.current?.load(); void player.current?.play()?.catch(() => {}); }}>Retry video</button>
          </p>}
          <h2>{video.title}</h2>
          <p>{video.description}</p>
          <div className="help-videos-meta">
            <span>{video.duration}</span>
            <span>{video.details}</span>
            {video.alsoIn && <span>Also in: {video.alsoIn}</span>}
            <button ref={fullscreenButton} type="button" className="help-videos-fullscreen" onClick={() => {
              player.current?.requestFullscreen?.().catch(() => {});
            }}><Maximize2 size={12} aria-hidden="true" /> Full screen</button>
            <a href={video.src} download={video.fileName}>Save video</a>
          </div>
        </div>
        <nav className="help-videos-list" aria-label="All videos">
          {groups.map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              {videos.filter((entry) => entry.group === group).map((entry) => (
                <button key={entry.id} type="button" className="help-videos-item" aria-current={entry.id === current}
                  onClick={() => open(entry.id)}>
                  <span className="help-video-thumb"><img src={entry.poster} alt="" /><span className="help-video-duration">{entry.duration}</span></span>
                  <span>
                    <strong>{entry.title}</strong>
                    {watched.includes(entry.id) ? <small className="is-watched">✓ Watched</small> : <small>{entry.duration}</small>}
                  </span>
                </button>
              ))}
            </section>
          ))}
        </nav>
      </div>
    </Modal>
  );
}
