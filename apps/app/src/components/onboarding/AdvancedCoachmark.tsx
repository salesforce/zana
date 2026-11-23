import { useEffect, useLayoutEffect, useState } from 'react';

/** The title-bar Basic/Advanced view switch (`BasicUiModeSwitch`). */
const ANCHOR = '.basic-ui-mode-switch';
const WIDTH = 300;
const GAP = 12;

/** Popover anchored under the title-bar Basic/Advanced view switch. Non-modal; follows layout changes. */
export function AdvancedCoachmark({ onGotIt, onSwitch }: { onGotIt: () => void; onSwitch: () => void }) {
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const anchor = document.querySelector(ANCHOR);
      if (!anchor) { setPos(null); return; }
      const rect = anchor.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const left = Math.max(8, Math.min(center - WIDTH / 2, window.innerWidth - WIDTH - 8));
      setPos({ left, top: rect.bottom + GAP, arrow: Math.max(16, Math.min(center - left, WIDTH - 16)) });
    };
    place();
    window.addEventListener('resize', place);
    const anchor = document.querySelector(ANCHOR);
    const observer = typeof ResizeObserver === 'function' && anchor ? new ResizeObserver(place) : null;
    if (anchor) observer?.observe(anchor);
    return () => { window.removeEventListener('resize', place); observer?.disconnect(); };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onGotIt(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onGotIt]);
  if (!pos) return null;
  return <div className="onb-coach" role="region" aria-label="Basic and Advanced" style={{ left: pos.left, top: pos.top, width: WIDTH, ['--ax' as string]: `${pos.arrow}px` }}>
    <strong>Basic ⇄ Advanced</strong>
    <p>Switch at any time. Your threads and projects stay the same. Advanced adds the full command center.</p>
    <div className="onb-cmp">
      <div><b>Basic</b>Threads · Projects · one composer</div>
      <div><b>Advanced</b>+ CLI Agents · Squads · Scheduler · Plugins · Inbox</div>
    </div>
    <div className="onb-row">
      <button type="button" className="onb-btn q sm" onClick={onGotIt}>Got it</button>
      <span className="onb-sp" />
      <button type="button" className="onb-btn p sm" onClick={onSwitch}>Switch to Advanced</button>
    </div>
  </div>;
}
