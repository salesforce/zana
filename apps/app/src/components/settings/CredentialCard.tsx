import { useState, type ReactNode } from 'react';
import { Eye, EyeOff, CheckCircle2, CircleDashed, type LucideIcon } from 'lucide-react';

/**
 * Gateway-style credential card — the shared visual language for the LLM
 * Providers surface (provider API keys, CLI-harness auth, custom endpoints).
 * Modelled on the "Express LLM Gateway" card: a bold title, a muted description
 * with an inline link, a labelled secret field with an in-field reveal toggle, a
 * status/metadata line, and a bordered action-button row.
 *
 * Security posture (Rule 1): main still authorizes every read, and a stored
 * secret is NEVER logged or printed. But on the operator's own local machine,
 * with their own keys, blind write-only was worse UX than useful — so
 * {@link SecretInput}'s reveal eye can, on explicit click, fetch and show the
 * *stored* value via an `onReveal` fetcher (used for a configured-but-empty
 * field); with no fetcher it falls back to only unmasking the text you are
 * *currently typing*. The card's status line still carries just the presence
 * boolean.
 */
export function CredentialCard({
  title,
  icon: Icon,
  desc,
  children
}: {
  title: string;
  icon?: LucideIcon;
  desc?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cred-card">
      <div className="cred-card-head">
        <div className="cred-card-title">
          {Icon && <Icon size={16} className="cred-card-icon" aria-hidden />}
          {title}
        </div>
        {desc && <p className="cred-card-desc">{desc}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * A labelled, masked secret input with an in-field reveal (eye) toggle.
 *
 * The eye has two jobs, decided by state:
 *  - While you're TYPING (the field has text), it unmasks what you typed so a
 *    paste can be eyeballed before saving.
 *  - On an empty-but-configured field, if `onReveal` is supplied it FETCHES the
 *    stored secret from main and shows it read-only (the local read-back the
 *    operator asked for). Clicking again hides it.
 */
export function SecretInput({
  label,
  placeholder,
  value,
  onChange,
  onEnter,
  ariaLabel,
  onReveal
}: {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  ariaLabel?: string;
  /** Fetch the STORED secret to reveal (returns null when nothing is stored).
   *  When provided, the eye can read back a saved value on an empty field. */
  onReveal?: () => Promise<string | null>;
}) {
  const [revealed, setRevealed] = useState(false);
  // The fetched stored secret, shown read-only; null = not currently revealing one.
  const [stored, setStored] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showingStored = stored !== null;
  // The eye is available when there's typed text OR a stored-secret fetcher.
  const eyeAvailable = value.length > 0 || !!onReveal;

  const toggle = async () => {
    // Typed text takes precedence — just unmask/mask what's in the buffer.
    if (value.length > 0) {
      setRevealed((r) => !r);
      return;
    }
    // Empty field: reveal or hide the stored secret via the fetcher.
    if (showingStored) {
      setStored(null);
      return;
    }
    if (!onReveal) return;
    setBusy(true);
    try {
      setStored((await onReveal()) ?? '');
    } catch {
      setStored('');
    } finally {
      setBusy(false);
    }
  };

  const displayValue = showingStored ? stored ?? '' : value;
  const unmasked = revealed || showingStored;

  return (
    <div className="cred-field">
      {label && <span className="cred-field-label">{label}</span>}
      <div className="cred-input-wrap">
        <input
          type={unmasked ? 'text' : 'password'}
          placeholder={placeholder}
          value={displayValue}
          readOnly={showingStored}
          aria-label={ariaLabel ?? label}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
          spellCheck={false}
          autoComplete="off"
        />
        {eyeAvailable && (
          <button
            type="button"
            className="cred-reveal-btn"
            disabled={busy}
            title={unmasked ? 'Hide' : value.length > 0 ? 'Reveal what you typed' : 'Reveal saved value'}
            aria-label={unmasked ? 'Hide value' : 'Reveal value'}
            onClick={toggle}
          >
            {unmasked ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        )}
      </div>
    </div>
  );
}

/** A labelled plain-text input (base URL, model, name) matching the card style. */
export function PlainInput({
  label,
  placeholder,
  value,
  onChange,
  onBlur,
  onEnter,
  mono
}: {
  label?: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onEnter?: () => void;
  mono?: boolean;
}) {
  return (
    <div className="cred-field">
      {label && <span className="cred-field-label">{label}</span>}
      <div className={`cred-input-wrap${mono ? '' : ' cred-input-wrap--plain'}`}>
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          aria-label={label}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/** Presence status line — the write-only analogue of "Source · Last validated". */
export function CredStatus({ configured, setLabel = 'Configured', unsetLabel = 'Not set' }: {
  configured: boolean;
  setLabel?: string;
  unsetLabel?: string;
}) {
  return (
    <div className={`cred-meta${configured ? ' cred-meta--set' : ''}`}>
      {configured ? (
        <CheckCircle2 size={13} className="cred-meta-icon" aria-hidden />
      ) : (
        <CircleDashed size={13} className="cred-meta-icon" aria-hidden />
      )}
      {configured ? setLabel : unsetLabel}
    </div>
  );
}
