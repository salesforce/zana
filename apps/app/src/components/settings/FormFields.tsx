import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export function Section({
  title,
  help,
  anchorId,
  flush,
  children
}: {
  title: string;
  help?: React.ReactNode;
  /** When set, renders `id="settings-anchor-<anchorId>"` so the section picker
   *  can scroll straight to this block (see SETTINGS_SUBSECTIONS). */
  anchorId?: string;
  /** Drop the panel border/background and keep only the heading + intro — for
   *  sections whose children are self-contained cards (the visual unit), so the
   *  chrome doesn't nest a card inside a card. */
  flush?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={`settings-section${flush ? ' settings-section--flush' : ''}`}
      id={anchorId ? `settings-anchor-${anchorId}` : undefined}
    >
      <h3>{title}</h3>
      {help && <p className="settings-help settings-section-help">{help}</p>}
      {children}
    </section>
  );
}

export function Field({
  label,
  help,
  mono,
  children
}: {
  label: string;
  help?: React.ReactNode;
  /** Render the value in the code font — for paths, binaries, versions. */
  mono?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`settings-field${mono ? ' settings-field--mono' : ''}`}>
      <label>
        <span className="settings-label">{label}</span>
        {children}
      </label>
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}

/**
 * A compact on/off switch — the essential control on every settings row that
 * reads as "show / enable this". Shared by the Editor opener rows and the Code
 * Harness rows (same `opener-switch` visual treatment in `global.css`).
 */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`opener-switch${checked ? ' opener-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="opener-switch-knob" />
    </button>
  );
}

/** Boolean settings row: label + help on the left, harness-style switch on the right. */
export function CheckboxField({
  label,
  help,
  checked,
  onChange,
  disabled
}: {
  label: string;
  help?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="settings-field settings-field--toggle">
      <div className="settings-toggle-row">
        <span className="settings-label">{label}</span>
        <ToggleSwitch
          checked={checked}
          onChange={onChange}
          label={label}
          disabled={disabled}
        />
      </div>
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}

/** Label + help on the left, action button on the right — same rhythm as CheckboxField. */
export function SettingsActionRow({
  label,
  help,
  children
}: {
  label: string;
  help?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-field settings-field--action">
      <div className="settings-action-row">
        <div className="settings-action-copy">
          <span className="settings-label">{label}</span>
          {help && <p className="settings-help">{help}</p>}
        </div>
        <div className="settings-action-control">{children}</div>
      </div>
    </div>
  );
}

export function ChipField({
  label,
  help,
  values,
  placeholder,
  onChange
}: {
  label: string;
  help?: React.ReactNode;
  values: string[];
  placeholder?: string;
  onChange: (vals: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const raw = input.trim();
    if (!raw) return;
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) {
      onChange([...values, ...parts]);
      setInput('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && input === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div className="settings-field">
      <span className="settings-label">{label}</span>
      <div
        className="settings-chip-input"
        role="group"
        aria-label={label}
        onClick={() => inputRef.current?.focus()}
      >
        {values.map((v, i) => (
          <span key={i} className="settings-chip">
            <span className="settings-chip-text">{v}</span>
            <button
              type="button"
              className="settings-chip-remove"
              aria-label={`Remove ${v}`}
              onClick={(e) => { e.stopPropagation(); remove(i); }}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="settings-chip-field"
          value={input}
          placeholder={values.length === 0 ? (placeholder ?? 'Type and press Enter or ,') : ''}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commit}
          aria-label={`Add ${label}`}
        />
      </div>
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}

/**
 * Tokenize a single argv-style line into tokens: split on whitespace, with
 * quoted segments (`"..."` / `'...'`) kept as one token so a path containing
 * a space can still be entered without being torn in two. Pure — exported for
 * direct unit testing.
 */
export function tokenizeArgsLine(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed))) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token) tokens.push(token);
  }
  return tokens;
}

/**
 * Plain-text alternative to `ChipField` for argv-shaped settings ("Extra
 * args") — one text box, space-separated, exactly like typing flags on a
 * command line. Avoids the chip UI's parsing ambiguity: a chip is one
 * visually discrete unit, so users naturally typed a whole `--flag value`
 * pair into one chip, which then got spliced into argv as a single
 * malformed token (`unknown option '--plugin-dir /some/path'`). A plain text
 * field carries no such expectation — `tokenizeArgsLine` splits it on
 * whitespace on blur/commit, same as a shell would.
 *
 * `values` (the stored `string[]`) is joined with spaces for display; typing
 * re-tokenizes on blur so the stored array stays the single source of truth
 * every launch path already consumes.
 */
export function TextArgsField({
  label,
  help,
  values,
  placeholder,
  onChange
}: {
  label: string;
  help?: React.ReactNode;
  values: string[];
  placeholder?: string;
  onChange: (vals: string[]) => void;
}) {
  const [input, setInput] = useState(values.join(' '));
  const focused = useRef(false);

  // The callers of this field (project/global settings) don't remount when
  // their underlying record swaps (e.g. switching the selected project) —
  // resync the draft from the live `values` whenever it changes, UNLESS the
  // user is actively typing, so an in-flight edit is never clobbered.
  useEffect(() => {
    if (!focused.current) setInput(values.join(' '));
  }, [values]);

  const commit = (raw: string) => {
    const tokens = tokenizeArgsLine(raw);
    onChange(tokens);
    setInput(tokens.join(' '));
  };

  return (
    <div className="settings-field settings-field--mono">
      <span className="settings-label">{label}</span>
      <input
        type="text"
        className="settings-input-full"
        value={input}
        placeholder={placeholder}
        onFocus={() => { focused.current = true; }}
        onChange={(e) => setInput(e.target.value)}
        onBlur={(e) => { focused.current = false; commit(e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(input);
          }
        }}
        spellCheck={false}
      />
      {help && <p className="settings-help">{help}</p>}
    </div>
  );
}
