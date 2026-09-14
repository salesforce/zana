import type { KeyboardEvent, RefObject } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH } from '@zana-ai/zcc-desktop-contract';

export interface BrowserFindMatches {
  activeMatchOrdinal: number;
  matches: number;
}

interface BrowserFindBarProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  matches: BrowserFindMatches | null;
  onQueryChange: (query: string) => void;
  onFindNext: () => void;
  onFindPrevious: () => void;
  onClose: () => void;
  shortcutLabel: string | null;
}

function formatBrowserFindMatches(matches: BrowserFindMatches | null): string | null {
  if (matches === null) return null;
  return `${matches.activeMatchOrdinal}/${matches.matches}`;
}

function FindBarButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function BrowserFindBar({
  inputRef,
  query,
  matches,
  onQueryChange,
  onFindNext,
  onFindPrevious,
  onClose,
  shortcutLabel
}: BrowserFindBarProps) {
  const matchLabel = formatBrowserFindMatches(matches);
  const hasMatches = matches !== null && matches.matches > 0;
  const noMatches = matches !== null && matches.matches === 0;

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) onFindPrevious();
      else onFindNext();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      data-testid="browser-find-bar"
      role="search"
      aria-label="Find in page"
      className="thread-browser-find"
    >
      <div className="thread-browser-find-field">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in page"
          aria-label={shortcutLabel ? `Find in page (${shortcutLabel})` : 'Find in page'}
          autoComplete="off"
          spellCheck={false}
          maxLength={DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH}
        />
        {matchLabel !== null ? (
          <span
            data-testid="browser-find-match-count"
            aria-live="polite"
            className={noMatches ? 'is-empty' : undefined}
          >
            {matchLabel}
          </span>
        ) : null}
      </div>
      <FindBarButton label="Previous match" disabled={!hasMatches} onClick={onFindPrevious}>
        <ChevronUp size={14} />
      </FindBarButton>
      <FindBarButton label="Next match" disabled={!hasMatches} onClick={onFindNext}>
        <ChevronDown size={14} />
      </FindBarButton>
      <FindBarButton label="Close find bar" onClick={onClose}>
        <X size={14} />
      </FindBarButton>
    </div>
  );
}
