import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { STUDIO_TOKENS } from './studio-tokens.js';

/** Native modal semantics keep keyboard focus inside the copy form. */
export function DuplicateScenarioDialog({ name, busy, error, onName, onCreate, onClose, returnFocus }: {
  returnFocus?: HTMLElement | null; name: string; busy: boolean; error: string; onName(value: string): void; onCreate(): void; onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    const previous = returnFocus ?? document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal(); input.current?.select();
    return () => { modal?.close(); previous?.focus(); };
  }, [returnFocus]);
  return createPortal(<dialog className="sf-scenario-dialog" ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-intro`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <style>{STUDIO_TOKENS}{`.sf-scenario-dialog{width:min(440px,calc(100vw - 32px));box-sizing:border-box;border:1px solid var(--sf-border);border-radius:12px;padding:24px;background:var(--sf-bg);color:var(--sf-text);font:inherit;box-shadow:0 16px 60px #0003}.sf-scenario-dialog::backdrop{background:#0006}.sf-scenario-dialog h3{margin:0 0 10px;font-size:20px}.sf-scenario-dialog p{color:var(--sf-muted);line-height:1.5}.sf-scenario-dialog label{display:flex;flex-direction:column;gap:8px;font-weight:600}.sf-scenario-dialog input{font:inherit;padding:10px;border:1px solid var(--sf-border);border-radius:6px;color:var(--sf-text);background:var(--sf-bg);min-width:0}.sf-scenario-dialog footer{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}.sf-scenario-dialog button{font:inherit;padding:9px 14px;border:1px solid var(--sf-border);border-radius:6px;background:var(--sf-bg);color:var(--sf-text);cursor:pointer}.sf-scenario-dialog .is-primary{background:var(--sf-accent);border-color:var(--sf-accent);color:var(--sf-on-accent)}.sf-scenario-dialog button:disabled{opacity:.5;cursor:default}.sf-scenario-dialog :focus-visible{outline:2px solid var(--sf-accent);outline-offset:3px}`}</style>
    <form onSubmit={event => { event.preventDefault(); if (!busy && name.trim()) onCreate(); }}>
      <h3 id={`${id}-title`}>Duplicate scenario</h3><p id={`${id}-intro`}>Create a separate scenario with a copy of this setup and its starting variables.</p>
      <label>New scenario name<input ref={input} autoFocus value={name} maxLength={80} disabled={busy} onChange={event => onName(event.target.value)} /></label>
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="is-primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create copy'}</button></footer>
    </form>
  </dialog>, document.body);
}
