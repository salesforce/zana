import { useEffect, useId, useRef, useState } from 'react';
import { SALESFORCE_STYLES } from './components/styles.js';

export function SaveAgentDialog(props: { busy: boolean; error: string | null; onSave(path: string): void; onClose(): void }) {
  const [path, setPath] = useState('MyAgent.agent');
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const previous = document.activeElement;
    ref.current!.showModal();
    ref.current!.querySelector('input')!.select();
    const dialog = ref.current!;
    return () => { dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  return <dialog className="sf-login-dialog" ref={ref} aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!props.busy) props.onClose(); }}>
    <style>{SALESFORCE_STYLES}</style>
    <form onSubmit={event => { event.preventDefault(); if (!props.busy) props.onSave(path.trim()); }}>
      <div className="sf-login-heading"><h2 id={title}>Save agent to project</h2><p>Create a new file from your current draft.</p></div>
      <div className="sf-login-body">
        <label className="sf-login-field">File path<input className="sf-input" value={path} onChange={event => setPath(event.target.value)} required disabled={props.busy} autoCapitalize="none" spellCheck={false} /><small>Use a .agent or .afscript filename in an existing project folder.</small></label>
        {props.error && <p className="sf-login-error" role="alert">{props.error}</p>}
      </div>
      <div className="sf-login-footer"><p>Existing files are never overwritten.</p><div className="sf-login-buttons"><button type="button" className="sf-btn quiet" disabled={props.busy} onClick={props.onClose}>Cancel</button><button className="sf-btn primary" disabled={props.busy || !path.trim()}>{props.busy ? 'Saving…' : 'Save new file'}</button></div></div>
    </form>
  </dialog>;
}
