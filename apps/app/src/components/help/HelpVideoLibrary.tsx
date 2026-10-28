import { useEffect, useRef } from 'react';
import { Maximize2 } from 'lucide-react';
import { HELP_VIDEOS, helpVideo } from '../../lib/help-videos.js';
import { Modal } from '../Modal.js';
import { trackWatched, useHelpVideos } from './help-videos-store.js';
import './help-menu.css';

/** Help → Videos: a player and the bundled catalogue. Mounted once near the app root. */
export function HelpVideoLibrary() {
  const openId = useHelpVideos((s) => s.openId);
  if (!openId) return null;
  return <Library current={openId} />;
}

function Library({ current }: { current: string }) {
  const { open, close, watched } = useHelpVideos();
  const video = helpVideo(current);
  const player = useRef<HTMLVideoElement>(null);
  const groups = [...new Set(HELP_VIDEOS.map((entry) => entry.group))];

  useEffect(() => {
    const element = player.current;
    if (!element) return;
    // Opening a clip is the request to play it; reduced motion keeps it paused.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    element.play()?.catch(() => {});
  }, [current]);

  return (
    <Modal title="Videos" onClose={close} className="help-videos-modal">
      <div className="help-videos" data-testid="help-video-library">
        <div className="help-videos-player">
          <video key={video.id} ref={player} aria-label={video.title} data-testid="help-video-player" controls playsInline
            muted={video.silent} preload="auto" poster={video.poster} onTimeUpdate={trackWatched(video.id)}>
            <source src={video.src} type="video/mp4" />
            <track kind="captions" src={video.captions} srcLang="en" label="English" />
            Your browser does not support video playback.
          </video>
          <h2>{video.title}</h2>
          <p>{video.description}</p>
          <div className="help-videos-meta">
            <span>{video.duration}</span>
            <span>{video.details}</span>
            <span>Also in: {video.alsoIn}</span>
            <button type="button" className="help-videos-fullscreen" onClick={() => {
              player.current?.requestFullscreen?.().catch(() => {});
            }}><Maximize2 size={12} aria-hidden="true" /> Full screen</button>
            <a href={video.src} download={video.fileName}>Save video</a>
          </div>
        </div>
        <nav className="help-videos-list" aria-label="All videos">
          {groups.map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              {HELP_VIDEOS.filter((entry) => entry.group === group).map((entry) => (
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
