import { useEffect, useRef, type FormEvent, type KeyboardEvent } from 'react';
import { Search, X } from 'lucide-react';
import { titleWithShortcut } from '../../lib/keyboard-shortcut-settings.js';
import { THREAD_SEARCH_PARTIAL_NOTE, threadSearchAnnouncement, threadSearchCounterText } from '../../lib/find-counter.js';
import { THREAD_SEARCH_QUERY_MAX } from '@zana-ai/zcc-thread-view';

export function threadDetailSearchClassName(draft: string): string {
  return draft.trim().length > 0 ? 'thread-detail-search has-query' : 'thread-detail-search';
}

export { THREAD_SEARCH_PARTIAL_NOTE, threadSearchAnnouncement, threadSearchCounterText };

export function ThreadDetailSearch({
  value,
  onChange,
  onSubmit,
  mobileHeader = false,
  autoFocus = false,
  focusRequest = 0,
  matchIndex,
  matchCount,
  partial = false,
  onClose
}: {
  value: string;
  mobileHeader?: boolean;
  autoFocus?: boolean;
  /** Bumped by the thread.find shortcut: focus the field and select its text. */
  focusRequest?: number;
  onClose?: () => void;
  onChange: (value: string) => void;
  /** Enter submits `'next'`, Shift+Enter `'previous'`; an empty needle clears. */
  onSubmit: (needle: string, direction?: 'next' | 'previous') => void;
  /** Current match (0-based, -1 for none yet); omit both to hide the counter. */
  matchIndex?: number;
  matchCount?: number;
  /** Only loaded messages were counted (the outline search failed). */
  partial?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const showCounter = matchCount !== undefined;
  const announcement = showCounter ? threadSearchAnnouncement(matchIndex ?? -1, matchCount, partial) : '';
  useEffect(() => { if (autoFocus) inputRef.current?.focus(); }, [autoFocus]);
  useEffect(() => {
    if (focusRequest === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusRequest]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value.trim());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      // Handled here so Shift+Enter steps back; focus stays in the field.
      event.preventDefault();
      onSubmit(value.trim(), event.shiftKey ? 'previous' : 'next');
      return;
    }
    if (event.key !== 'Escape') return;
    onChange('');
    onSubmit('');
    event.currentTarget.blur();
    onClose?.();
  };

  return (
    <form
      className={threadDetailSearchClassName(value)}
      data-testid="thread-detail-search"
      onSubmit={submit}
    >
      <button
        type="button"
        className="icon-btn thread-detail-search-toggle"
        aria-label="Search in thread"
        title={titleWithShortcut('Search in thread', 'thread.find')}
        onPointerDown={(event) => {
          // Focusing the toggle would move it as the mobile header expands,
          // before the tap can click it and focus the input.
          if (mobileHeader) event.preventDefault();
        }}
        onClick={() => inputRef.current?.focus()}
      >
        <Search size={14} />
      </button>
      <input
        ref={inputRef}
        type="search"
        value={value}
        aria-label="Search in thread"
        placeholder="Search"
        maxLength={THREAD_SEARCH_QUERY_MAX}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      {showCounter && <span
        className={`thread-detail-search-count${matchCount === 0 ? ' is-empty' : ''}${partial ? ' is-partial' : ''}`}
        data-testid="thread-detail-search-count"
        title={announcement}
        aria-hidden="true"
      >{threadSearchCounterText(matchIndex ?? -1, matchCount, partial)}</span>}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      {mobileHeader && <button
        type="button"
        className="icon-btn thread-detail-search-close"
        aria-label="Close search"
        onClick={(event) => {
          onChange('');
          onSubmit('');
          inputRef.current?.blur();
          event.currentTarget.blur();
          onClose?.();
        }}
      ><X size={18} aria-hidden="true" /></button>}
    </form>
  );
}
