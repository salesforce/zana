import { useRef, useState } from 'react';
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
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`opener-switch${checked ? ' opener-switch--on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="opener-switch-knob" />
    </button>
  );
}

export function CheckboxField({
  label,
  help,
  checked,
  onChange
}: {
  label: string;
  help?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="settings-field settings-field--check">
      <label className="settings-check">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {help && <p className="settings-help">{help}</p>}
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
