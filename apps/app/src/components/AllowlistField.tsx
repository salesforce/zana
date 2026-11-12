import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

/**
 * Shared allowlist control (checkbox, typeahead, chips, inline warnings, fixed
 * always-allowed chips) used by "Restrict skills" and "Restrict MCP servers".
 *
 * Storage contract, owned by the caller: unrestricted = the field is absent,
 * restricted with no entries = `[]` (nothing beyond the always-allowed entries),
 * restricted with entries = exactly those. This component owns no field-specific
 * rule: each field supplies its own suggestions, per-entry state, validation and
 * warning copy.
 */

export type AllowlistEntryState =
  | { kind: 'ok' }
  | { kind: 'missing' }
  | { kind: 'unavailable'; reason?: string }
  | { kind: 'ambiguous'; matches: readonly string[] };

export interface AllowlistSuggestion {
  value: string;
  /** Right-aligned secondary text, e.g. the server source. */
  hint?: string;
}

/** Split comma/newline text into a clean list, exactly like the legacy comma-text field. */
export function parseAllowlistText(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface AllowlistFieldProps {
  testId: string;
  checkboxId: string;
  title: string;
  restricted: boolean;
  onRestrictedChange: (restricted: boolean) => void;
  entries: string[];
  onEntriesChange: (entries: string[]) => void;
  /** Accessible name of the typeahead input. */
  inputLabel: string;
  placeholder: string;
  /** Candidate completions; already-added entries are filtered out here. */
  suggestions?: readonly AllowlistSuggestion[];
  /** Where the suggestions come from; a non-ready source is announced, never blocking. */
  suggestionsStatus?: 'ready' | 'loading' | 'unavailable';
  /** Fixed chips that are always allowed and cannot be removed. */
  alwaysAllowed: readonly string[];
  entryState?: (entry: string) => AllowlistEntryState;
  /** Returns an error message to refuse a typed entry. */
  validateEntry?: (entry: string) => string | undefined;
  maxEntries?: number;
  exactHint: string;
  emptyHint: string;
  /**
   * Opt-in comma-text twin of the chips (visually hidden, not exposed to assistive
   * tech). It parses and serialises exactly like the legacy single text input, so
   * paste/automation that drives that text keeps working. Value is its accessible name.
   */
  commaTextLabel?: string;
  /** Inline warnings and notices, rendered under the chips. */
  children?: ReactNode;
}

const MAX_SUGGESTIONS = 50;

export function AllowlistField(props: AllowlistFieldProps) {
  const {
    testId, checkboxId, title, restricted, onRestrictedChange, entries, onEntriesChange, inputLabel,
    placeholder, suggestions = [], suggestionsStatus = 'ready', alwaysAllowed, entryState, validateEntry,
    maxEntries, exactHint, emptyHint, commaTextLabel, children
  } = props;
  const uid = useId();
  const listboxId = `${uid}-listbox`;
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const options = useMemo(() => {
    const needle = draft.trim().toLowerCase();
    return suggestions
      .filter((s) => !entries.includes(s.value))
      .filter((s) => !needle || s.value.toLowerCase().includes(needle) || (s.hint ?? '').toLowerCase().includes(needle))
      .slice(0, MAX_SUGGESTIONS);
  }, [suggestions, entries, draft]);
  const listVisible = open && restricted;
  const activeOption = active >= 0 && active < options.length ? options[active] : undefined;

  const commitAll = (raw: string[]): boolean => {
    let next = entries;
    let problem: string | undefined;
    for (const value of raw) {
      const entry = value.trim();
      if (!entry || next.includes(entry)) continue;
      const invalid = validateEntry?.(entry);
      if (invalid) { problem = invalid; continue; }
      if (maxEntries !== undefined && next.length >= maxEntries) {
        problem = `At most ${maxEntries} entries.`;
        break;
      }
      next = [...next, entry];
    }
    setError(problem);
    if (next !== entries) onEntriesChange(next);
    return !problem;
  };

  const resetInput = () => { setDraft(''); setActive(-1); setOpen(false); };

  const commitDraft = () => {
    if (!draft.trim()) { resetInput(); return; }
    if (commitAll([draft])) resetInput();
  };

  const onInputChange = (value: string) => {
    setError(undefined);
    if (/[\n,]/.test(value)) {
      const tokens = value.split(/[\n,]/);
      const rest = tokens.pop() ?? '';
      commitAll(tokens);
      setDraft(rest);
    } else {
      setDraft(value);
    }
    setActive(-1);
    setOpen(true);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (listVisible && activeOption) { if (commitAll([activeOption.value])) resetInput(); }
      else commitDraft();
    } else if (e.key === 'Escape') {
      if (listVisible) { e.preventDefault(); setOpen(false); setActive(-1); }
    } else if (e.key === 'Backspace' && draft === '' && entries.length > 0) {
      e.preventDefault();
      setError(undefined);
      onEntriesChange(entries.slice(0, -1));
    }
  };

  const hint = entries.length ? exactHint : emptyHint;

  return (
    <div className="scheduler-form-field allowlist-field" data-testid={testId}>
      <label htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={restricted}
          onChange={(e) => onRestrictedChange(e.target.checked)}
        />{' '}
        {title}
      </label>
      {restricted && (
        <div className="allowlist-body">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={inputLabel}
            aria-autocomplete="list"
            aria-expanded={listVisible}
            aria-controls={listboxId}
            aria-activedescendant={listVisible && activeOption ? `${uid}-opt-${active}` : undefined}
            autoComplete="off"
            value={draft}
            placeholder={placeholder}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => { if (draft) setOpen(true); }}
            onBlur={commitDraft}
          />
          <div
            id={listboxId}
            role="listbox"
            aria-label={`${inputLabel} suggestions`}
            className="allowlist-suggest"
            data-testid="allowlist-suggest"
            hidden={!listVisible}
          >
            {options.map((o, i) => (
              <div
                key={o.value}
                id={`${uid}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`allowlist-option${i === active ? ' is-active' : ''}`}
                // Keep focus in the input so blur does not commit a half-typed draft first.
                onMouseDown={(e) => { e.preventDefault(); if (commitAll([o.value])) resetInput(); }}
              >
                <span>{o.value}</span>
                {o.hint && <small>{o.hint}</small>}
              </div>
            ))}
            {options.length === 0 && (
              <div className="allowlist-option-empty settings-help">
                {draft.trim() ? `No match. Enter adds "${draft.trim()}" anyway.` : 'No more suggestions.'}
              </div>
            )}
          </div>
          {suggestionsStatus !== 'ready' && (
            <p className="settings-help persona-form-hint" role="status" data-testid="allowlist-suggestions-status">
              {suggestionsStatus === 'loading'
                ? 'Loading suggestions…'
                : 'Suggestions are unavailable. You can still type names.'}
            </p>
          )}
          {error && (
            <p className="settings-help persona-form-hint allowlist-warn" role="alert" data-testid="allowlist-error">{error}</p>
          )}
          <div className="allowlist-chips" role="group" aria-label={`${inputLabel} list`} aria-live="polite">
            {entries.map((entry, i) => {
              const state = entryState?.(entry) ?? { kind: 'ok' as const };
              const flagged = state.kind !== 'ok';
              return (
                <span
                  key={`${i}:${entry}`}
                  className={`settings-chip allowlist-chip${flagged ? ' allowlist-chip--warn' : ''}`}
                  data-testid="allowlist-chip"
                  data-state={state.kind}
                >
                  <span className="settings-chip-text" title={entry}>{entry}</span>
                  {flagged && (
                    <span className="allowlist-chip-mark" role="img" aria-label={markLabel(state)} title={markLabel(state)}>
                      {state.kind === 'ambiguous' ? '?' : '!'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="settings-chip-remove"
                    aria-label={`Remove ${entry}`}
                    onClick={() => { setError(undefined); onEntriesChange(entries.filter((_, j) => j !== i)); }}
                  >
                    <X size={10} />
                  </button>
                </span>
              );
            })}
            {alwaysAllowed.map((entry) => (
              <span key={`always:${entry}`} className="settings-chip allowlist-chip allowlist-chip--fixed" data-testid="allowlist-fixed-chip" title="Always available">
                <span className="settings-chip-text">{entry} (always)</span>
              </span>
            ))}
          </div>
          <p className="settings-help persona-form-hint" data-testid="allowlist-hint">{hint}</p>
          {commaTextLabel && (
            <input
              type="text"
              className="allowlist-text-twin"
              aria-label={commaTextLabel}
              aria-hidden="true"
              tabIndex={-1}
              value={entries.join(', ')}
              onChange={(e) => onEntriesChange(parseAllowlistText(e.target.value))}
            />
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function markLabel(state: AllowlistEntryState): string {
  switch (state.kind) {
    case 'missing': return 'Not installed';
    case 'unavailable': return 'Unavailable';
    case 'ambiguous': return 'Matches several sources';
    default: return '';
  }
}
