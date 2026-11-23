import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Sparkles, X } from 'lucide-react';
import { measureHelpTips, type HelpTip, type PositionedHelpTip } from './help-targets.js';
import { useHelp } from './HelpProvider.js';
import { useOnboarding } from '../onboarding/onboarding-store.js';
import '../../styles/contextual-help.css';

/** A guide over real controls: hiding it never remounts the page's children. */
export function ContextualHelp({ children, surfaceId, tips, invitation = 'Need a few tips?', regionLabel = 'Page tip', className = '' }: {
  children: ReactNode;
  surfaceId: string;
  tips: readonly HelpTip[];
  invitation?: string;
  regionLabel?: string;
  className?: string;
}) {
  const { enabled: helpEnabled, activeSurface, explore, finish } = useHelp();
  // The setup companion already guides first run, so the tips invitation waits (open or minimized).
  const onboardingOpen = useOnboarding(state => state.open);
  const instanceId = useId();
  const surfaceKey = `${surfaceId}-${instanceId}`;
  const enabled = helpEnabled && activeSurface === surfaceKey;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [positions, setPositions] = useState<PositionedHelpTip[]>([]);
  const surface = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const dots = useRef(new Map<string, HTMLButtonElement>());
  const id = useId();
  const selectedIndex = positions.findIndex(({ tip }) => tip.id === selectedId);
  const selected = positions[selectedIndex];

  useEffect(() => {
    if (!enabled || !surface.current) return;
    const root = surface.current;
    let frame = 0;
    const measure = () => {
      const next = measureHelpTips(root, tips);
      setPositions(next);
      setSelectedId((current) => next.some(({ tip }) => tip.id === current) ? current : null);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    const resize = new ResizeObserver(schedule);
    resize.observe(root);
    // Mode switches, async model labels, and responsive disclosures move dots.
    const mutations = new MutationObserver(schedule);
    mutations.observe(root, {
      childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-expanded']
    });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [enabled, tips]);

  useEffect(() => { if (!enabled) setSelectedId(null); }, [enabled]);
  useEffect(() => () => finish(surfaceKey), [finish, surfaceKey]);
  const done = () => { finish(surfaceKey); toggle.current?.focus(); };

  const closeCard = () => {
    if (selectedId) dots.current.get(selectedId)?.focus();
    setSelectedId(null);
  };

  const helperButton = (event: MouseEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.target as Node)) return null;
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    return button?.closest('[data-contextual-help-ui]') ? button : null;
  };

  return (
    <div className={`contextual-help ${className}`} data-help-surface={surfaceId}
      onMouseDownCapture={(event) => {
        // Preserve the mobile composer's height until the click lands. Use
        // mousedown: cancelling pointerdown suppresses clicks on mobile Safari.
        if (helperButton(event)) event.preventDefault();
      }}
      onClickCapture={(event) => helperButton(event)?.focus({ preventScroll: true })}
      onKeyDown={(event) => {
        // Nested portalled pickers and the composer own their keyboard events.
        if (event.key !== 'Escape' || event.defaultPrevented || !event.currentTarget.contains(event.target as Node)) return;
        if (!(event.target as Element).closest('[data-contextual-help-ui]')) return;
        event.stopPropagation();
        if (selected) closeCard();
        else done();
      }}>
      {helpEnabled && !onboardingOpen && <div className={`contextual-help-invitation${enabled ? ' is-active' : ''}`} data-contextual-help-ui>
        <svg className="contextual-help-arrow" viewBox="0 0 112 72" fill="none" aria-hidden="true">
          <path d="M100 10C69 1 34 12 35 34C36 53 65 55 72 38C79 19 38 26 12 63M12 63L14 47M12 63L29 59" />
        </svg>
        <button ref={toggle} type="button" className="contextual-help-toggle"
          aria-pressed={enabled} aria-controls={enabled ? `${id}-dots` : undefined}
          onClick={() => { if (enabled) done(); else explore(surfaceKey); setSelectedId(null); }}>
          <Sparkles size={16} aria-hidden="true" />
          <span><strong>{enabled ? 'Done' : invitation}</strong>
            <small>{enabled ? 'Click a dot to explore' : 'Let’s show you around'}</small></span>
        </button>
      </div>}
      <div className="contextual-help-stage">
        <div ref={surface} className="contextual-help-surface">{children}</div>
        {enabled && <div id={`${id}-dots`} className="contextual-help-dots" data-contextual-help-ui>
          {positions.map(({ tip, left, top }, index) => (
            <button key={tip.id} type="button"
              ref={(node) => { if (node) dots.current.set(tip.id, node); else dots.current.delete(tip.id); }}
              className={`contextual-help-tip-dot${selectedId === tip.id ? ' is-active' : ''}`}
              style={{ left, top }} data-tip-id={tip.id}
              aria-label={`Tip: ${tip.title}`} aria-pressed={selectedId === tip.id}
              aria-controls={selectedId === tip.id ? `${id}-explanation` : undefined} title={tip.title}
              onClick={() => setSelectedId(tip.id)}>{index + 1}</button>
          ))}
        </div>}
      </div>
      {enabled && selected && (
        <section className="contextual-help-tip-card" id={`${id}-explanation`}
          aria-label={regionLabel} data-contextual-help-ui>
          <div className="contextual-help-tip-card-heading">
            <span className="contextual-help-tip-card-number">{selectedIndex + 1}</span>
            <h3>{selected.tip.title}</h3>
            <button type="button" aria-label="Close tip" onClick={closeCard}><X size={16} aria-hidden="true" /></button>
          </div>
          <p aria-live="polite">{selected.tip.description}</p>
          <footer>
            <span>{selectedIndex + 1} of {positions.length}</span>
            <button type="button" aria-label="Previous tip" disabled={selectedIndex === 0}
              onClick={() => setSelectedId(positions[selectedIndex - 1].tip.id)}><ArrowLeft size={14} aria-hidden="true" /></button>
            <button type="button" aria-label="Next tip" disabled={selectedIndex === positions.length - 1}
              onClick={() => setSelectedId(positions[selectedIndex + 1].tip.id)}><ArrowRight size={14} aria-hidden="true" /></button>
          </footer>
        </section>
      )}
    </div>
  );
}
