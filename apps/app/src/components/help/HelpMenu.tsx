import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, CircleHelp, Gift, Play, RotateCcw, Sparkles } from 'lucide-react';
import { HELP_VIDEOS } from '../../lib/help-videos.js';
import { openWhatsNewAll, useUi } from '../../store.js';
import { useHelp } from './HelpProvider.js';
import { useHelpVideos } from './help-videos-store.js';
import '../../styles/contextual-help.css';
import './help-menu.css';

/**
 * Title-bar "?": a menu whose first row is the page-hints switch (the icon
 * stays highlighted while hints are on), then the video catalogue and the
 * other ways to learn the app.
 */
export function HelpMenu() {
  const { enabled, setEnabled } = useHelp();
  const watched = useHelpVideos((s) => s.watched);
  const openVideos = useHelpVideos((s) => s.open);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    popover.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  // Focus the trigger first so a dialog opened by the action returns there.
  const run = (action: () => void) => { setOpen(false); trigger.current?.focus(); action(); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(popover.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
    event.preventDefault();
  };

  return (
    <div className="help-menu" ref={root} onKeyDown={open ? onKeyDown : undefined}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
      <button ref={trigger} type="button" data-help-toggle="titlebar" data-testid="titlebar-help-toggle"
        className={`titlebar-help${enabled ? ' is-active' : ''}${open ? ' is-open' : ''}`}
        aria-label="Help" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'help-menu-popover' : undefined}
        title="Help, videos and page hints" onClick={() => setOpen((value) => !value)}>
        <CircleHelp size={15} aria-hidden="true" />
      </button>
      {open && (
        <div className="help-menu-popover" id="help-menu-popover" ref={popover} role="dialog" tabIndex={-1} aria-label="Help">
          <button type="button" role="switch" aria-checked={enabled} className="help-menu-row" data-testid="help-hints-switch"
            onClick={() => setEnabled(!enabled)}>
            <Sparkles size={16} aria-hidden="true" />
            <span>Page hints<small>Tips on the page you’re looking at</small></span>
            <span className={`help-menu-switch${enabled ? ' is-on' : ''}`} aria-hidden="true" />
          </button>
          <div className="help-menu-separator" />
          <div className="help-menu-heading">
            <span>Watch</span>
            <button type="button" className="help-menu-all" onClick={() => run(() => openVideos())}>
              All videos <ArrowRight size={12} aria-hidden="true" />
            </button>
          </div>
          <div className="help-menu-videos">
            {HELP_VIDEOS.map((video) => {
              const seen = watched.includes(video.id);
              return (
                <button key={video.id} type="button" className="help-menu-video" aria-label={`Play ${video.title}, ${video.duration}${seen ? ', watched' : ''}`}
                  onClick={() => run(() => openVideos(video.id))}>
                  <span className="help-video-thumb">
                    <img src={video.poster} alt="" />
                    {seen ? <span className="help-video-seen">✓ Watched</span> : null}
                    <span className="help-video-duration">{video.duration}</span>
                    <span className="help-video-play"><Play size={13} aria-hidden="true" /></span>
                  </span>
                  <span className="help-menu-video-title">{video.title}<small>{video.group}</small></span>
                </button>
              );
            })}
          </div>
          <div className="help-menu-separator" />
          <button type="button" className="help-menu-row" onClick={() => run(() => useUi.getState().setWalkthroughOpen(true))}>
            <RotateCcw size={16} aria-hidden="true" /><span>Replay walkthrough</span>
          </button>
          <button type="button" className="help-menu-row" onClick={() => run(() => void openWhatsNewAll())}>
            <Gift size={16} aria-hidden="true" /><span>What’s new</span>
          </button>
        </div>
      )}
    </div>
  );
}
