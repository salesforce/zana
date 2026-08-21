import { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal.js';

interface Props {
  title: string;
  /** Optional helper line under the title. */
  hint?: string;
  /** Label for the text input. */
  label: string;
  /** Pre-filled value (e.g. the current name when renaming). */
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Resolve with the trimmed value, or null if the user cancelled. */
  onSubmit: (value: string) => void;
  onClose: () => void;
}

/**
 * In-app replacement for `window.prompt`, which Electron's renderer disables
 * (it returns null and logs an error). Built on the shared {@link Modal}
 * primitive (backdrop/focus-trap/Escape/aria). Enter submits; the field
 * auto-focuses and pre-selects any initial value, matching native prompt
 * behavior for renames.
 */
export function PromptModal({
  title,
  hint,
  label,
  initialValue = '',
  placeholder,
  confirmLabel = 'OK',
  onSubmit,
  onClose
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      className="prompt-modal"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={!value.trim()} onClick={submit}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {hint && <div className="modal-hint">{hint}</div>}
      <label className="prompt-modal-field">
        <span>{label}</span>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
        />
      </label>
    </Modal>
  );
}
