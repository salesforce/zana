import { useEffect, useRef, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { threadSearchAnnouncement, threadSearchCounterText } from '../lib/find-counter.js';

export interface DomFindBarProps {
  value: string;
  onChange: (value: string) => void;
  onStep: (direction: 1 | -1) => void;
  onClose: () => void;
  matchIndex: number;
  matchCount: number;
  /** Bumped on each Ctrl+F: focus the field and select its text. */
  focusRequest: number;
  label?: string;
}

function FindStepButtons({ matchCount, onStep, onClose }: Pick<DomFindBarProps, 'matchCount' | 'onStep' | 'onClose'>) {
  return (
    <>
      <button type="button" className="icon-btn" aria-label="Previous match" title="Previous match (Shift+Enter)" disabled={matchCount === 0} onClick={() => onStep(-1)}><ChevronUp size={14} /></button>
      <button type="button" className="icon-btn" aria-label="Next match" title="Next match (Enter)" disabled={matchCount === 0} onClick={() => onStep(1)}><ChevronDown size={14} /></button>
      <button type="button" className="icon-btn" aria-label="Close find" title="Close (Esc)" onClick={onClose}><X size={14} /></button>
    </>
  );
}

function useFocusOnRequest(focusRequest: number) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);
  return inputRef;
}

/**
 * Floating find bar for rendered content. Reuses the thread search's counter
 * and screen-reader text so both read the same (`3/7`, "Match 3 of 7").
 * Enter / Shift+Enter step here; Esc is left to the surface (`useDomFind`),
 * which also owns F3 and returning focus.
 */
export function DomFindBar({ value, onChange, onStep, onClose, matchIndex, matchCount, focusRequest, label = 'Find in page' }: DomFindBarProps) {
  const inputRef = useFocusOnRequest(focusRequest);
  const hasQuery = value.length > 0;
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    onStep(event.shiftKey ? -1 : 1);
  };
  return (
    <div className="dom-find-bar" role="search" data-testid="dom-find-bar">
      <input ref={inputRef} type="search" value={value} placeholder="Find" aria-label={label} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} />
      {hasQuery && <span
        className={`dom-find-bar-count${matchCount === 0 ? ' is-empty' : ''}`}
        data-testid="dom-find-bar-count"
        aria-hidden="true"
      >{threadSearchCounterText(matchIndex, matchCount)}</span>}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{hasQuery ? threadSearchAnnouncement(matchIndex, matchCount) : ''}</span>
      <FindStepButtons matchCount={matchCount} onStep={onStep} onClose={onClose} />
    </div>
  );
}
