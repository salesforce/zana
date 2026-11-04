import { useState } from 'react';

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/;

/** Normalizes a typed pairing code to `XXXX-XXXX`, or null when it is not well formed. UX only; the server validates. */
export function normalizePairingCode(input: string): string | null {
  const squashed = input.toUpperCase().replace(/[\s-]+/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return CROCKFORD.test(squashed) ? `${squashed.slice(0, 4)}-${squashed.slice(4)}` : null;
}

export interface ApproveConnectionProps {
  hostname: string;
  fingerprint: string;
  onApprove(code: string): Promise<void> | void;
  onDeny(): void;
  busy?: boolean;
}

export function ApproveConnection({ hostname, fingerprint, onApprove, onDeny, busy = false }: ApproveConnectionProps) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const code = normalizePairingCode(value);
  const disabled = busy || submitting;

  const submit = async () => {
    if (!code || disabled) return;
    setSubmitting(true);
    setError(null);
    try {
      await onApprove(code);
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Request failed');
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="peers-approve" data-testid="peer-approve">
      <p className="peers-approve-title"><strong>{hostname}</strong> wants to connect to this computer.</p>
      <p className="peers-approve-fingerprint">Fingerprint: <code>{fingerprint}</code></p>
      <label className="peers-approve-label">
        Code shown on the other computer
        <input
          className="peers-approve-input"
          type="text"
          autoComplete="off"
          spellCheck={false}
          placeholder="____-____"
          aria-describedby="pairing-code-hint"
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
        />
        <span id="pairing-code-hint" className="peers-approve-hint">8 letters and digits, not case-sensitive</span>
      </label>
      {error && <p className="peers-error" role="alert">{error}</p>}
      <div className="peers-actions">
        <button type="button" className="btn primary" disabled={!code || disabled} onClick={() => void submit()}>Approve</button>
        <button type="button" className="btn peers-btn-remove" disabled={disabled} onClick={onDeny}>Deny</button>
      </div>
    </div>
  );
}
