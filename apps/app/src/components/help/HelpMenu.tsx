import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, Bot, ChevronRight, CircleHelp, Clapperboard, Play, Rocket, RotateCcw, Sparkles, Users } from 'lucide-react';
import type { HelpVideo } from '../../lib/help-videos.js';
import { useUi } from '../../store.js';
import type { ReleaseNote } from '@zana-ai/zcc-domain/product';
import { HelpReleaseNotesSection, ReleaseNotesBrowser } from './HelpReleaseNotes.js';
import { useHelp } from './HelpProvider.js';
import { useHelpVideos } from './help-videos-store.js';
import '../../styles/contextual-help.css';
import './help-menu.css';

function categoryPresentation(group: string) {
  switch (group) {
    case 'Getting started': return { Icon: Rocket, description: 'The basics, in a few minutes' };
    case 'Agentforce': return { Icon: Bot, description: 'Build and test your agents' };
    case 'Squads': return { Icon: Users, description: 'Build, launch and manage runs' };
    default: return group.startsWith('What’s new')
      ? { Icon: Sparkles, description: 'The latest in Zana' }
      : { Icon: Clapperboard, description: 'Explore tutorials and walkthroughs' };
  }
}

/**
 * Title-bar "?": a menu whose first row is the page-hints switch (the icon
 * stays highlighted while hints are on), then the video catalogue and the
 * other ways to learn the app.
 */
export function HelpMenu() {
  const { enabled, setEnabled } = useHelp();
  const watched = useHelpVideos((s) => s.watched);
  const openVideos = useHelpVideos((s) => s.open);
  const videos = useHelpVideos((s) => s.videos);
  const refreshVideos = useHelpVideos((s) => s.refresh);
  const [open, setOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [releaseNotes, setReleaseNotes] = useState<ReleaseNote[] | null>(null);
  const categoryId = useId();
  const grouped = new Map<string, HelpVideo[]>();
  for (const video of videos) {
    const entries = grouped.get(video.group) ?? [];
    entries.push(video);
    grouped.set(video.group, entries);
  }
  // Keep tutorials first, followed by release highlights, in catalogue order.
  const categories = [...grouped].sort(([a], [b]) => Number(a.startsWith('What’s new')) - Number(b.startsWith('What’s new')));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    void refreshVideos();
    popover.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, refreshVideos]);

  const close = () => { setOpen(false); trigger.current?.focus(); };
  // Focus the trigger first so a dialog opened by the action returns there.
  const run = (action: () => void) => { setOpen(false); trigger.current?.focus(); action(); };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.stopPropagation(); close(); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = Array.from(popover.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const step = event.key === 'ArrowDown' ? 1 : -1;
    items[(index + step + items.length) % items.length]?.focus();
    event.preventDefault();
  };

  return (
    <>
      <div className="help-menu" ref={root} onKeyDown={open ? onKeyDown : undefined}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
        <button ref={trigger} type="button" data-help-toggle="titlebar" data-testid="titlebar-help-toggle"
          className={`titlebar-help${enabled ? ' is-active' : ''}${open ? ' is-open' : ''}`}
          aria-label="Help" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'help-menu-popover' : undefined}
          title="Help, videos and page hints" onClick={() => { setOpen((value) => !value); setExpandedCategory(null); }}>
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
            <div className="help-menu-categories">
              {categories.map(([group, entries], index) => {
                const expanded = expandedCategory === group;
                const { Icon, description } = categoryPresentation(group);
                const id = `${categoryId}-${index}`;
                return (
                  <section key={group} className="help-menu-category">
                    <button type="button" className="help-menu-category-toggle" aria-expanded={expanded} aria-controls={id}
                      aria-label={`${group}, ${entries.length} ${entries.length === 1 ? 'video' : 'videos'}`}
                      onClick={() => setExpandedCategory(expanded ? null : group)}>
                      <span className="help-menu-category-icon"><Icon size={17} aria-hidden="true" /></span>
                      <span className="help-menu-category-name">{group}<small>{description}</small></span>
                      <span className="help-menu-category-count" aria-hidden="true">{entries.length}</span>
                      <ChevronRight size={13} className="help-menu-category-chevron" aria-hidden="true" />
                    </button>
                    <div id={id} hidden={!expanded}>
                      {expanded && <div className="help-menu-videos">
                        {entries.map((video) => {
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
                              <span className="help-menu-video-title">{video.title}</span>
                            </button>
                          );
                        })}
                      </div>}
                    </div>
                  </section>
                );
              })}
            </div>
            <div className="help-menu-separator" />
            <HelpReleaseNotesSection onOpen={(notes) => run(() => setReleaseNotes(notes))} />
            <div className="help-menu-separator" />
            <button type="button" className="help-menu-row" onClick={() => run(() => useUi.getState().setWalkthroughOpen(true))}>
              <RotateCcw size={16} aria-hidden="true" /><span>Replay walkthrough</span>
            </button>
          </div>
        )}
      </div>
      {releaseNotes && <ReleaseNotesBrowser notes={releaseNotes} onClose={() => setReleaseNotes(null)} />}
    </>
  );
}
