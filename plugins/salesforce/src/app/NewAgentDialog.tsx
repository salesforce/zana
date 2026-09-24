import { useEffect, useId, useRef, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { suggestedAgentName, type CreatedAgentDraft } from '../../lib/agent-draft-contract.js';
import { SALESFORCE_STYLES } from './components/styles.js';

type NewAgentDialogProps = {
  pluginId: string; projectId?: string; onClose(): void; onCreated(file: CreatedAgentDraft): Promise<void>;
};

export function NewAgentDialog(props: NewAgentDialogProps) {
  return <NewAgentForm key={JSON.stringify([props.pluginId, props.projectId])} {...props} />;
}

function NewAgentForm({ pluginId, projectId, onClose, onCreated }: NewAgentDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [name, setName] = useState('');
  const [apiName, setApiName] = useState('');
  const [customApiName, setCustomApiName] = useState(false);
  const [purpose, setPurpose] = useState('');
  const [destination, setDestination] = useState<{ directory: string; initializesProject: boolean } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const creating = useRef(false);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement;
    const dialog = ref.current!;
    dialog.showModal(); dialog.querySelector('input')?.focus();
    void callPluginRpc(pluginId, 'agents.draft.destination', { projectId }).then(value => {
      const result = value as { ok?: boolean; error?: string; directory: string; initializesProject: boolean };
      if (!result.ok) throw Error(result.error || 'Could not find the project folder.');
      if (alive.current) setDestination(result);
    }).catch(e => { if (alive.current) setError(String(e.message)); });
    return () => { alive.current = false; dialog.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [pluginId, projectId]);
  async function create() {
    if (!destination || creating.current) return;
    creating.current = true; setBusy(true); setError('');
    try {
      const result = await callPluginRpc(pluginId, 'agents.draft.create', { projectId, name, apiName, purpose }) as { ok?: boolean; error?: string; file?: CreatedAgentDraft };
      if (!result.ok || !result.file) throw Error(result.error || 'Could not create the agent.');
      if (alive.current) { await onCreated(result.file); if (alive.current) onClose(); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : 'Could not create the agent.'); }
    finally { creating.current = false; if (alive.current) setBusy(false); }
  }
  return <dialog className="sf-login-dialog" ref={ref} aria-labelledby={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <style>{SALESFORCE_STYLES}</style>
    <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <div className="sf-login-heading"><h2 id={title}>New agent</h2><p>Start with a local draft, then bring it to life in the editor.</p></div>
      <div className="sf-login-body">
        <label className="sf-login-field">Name<input className="sf-input" required maxLength={120} placeholder="Customer support" disabled={busy} value={name} onChange={event => { setName(event.target.value); if (!customApiName) setApiName(suggestedAgentName(event.target.value)); }} /></label>
        <label className="sf-login-field">API name<input className="sf-input" required maxLength={80} pattern="[A-Za-z][A-Za-z0-9]*(_[A-Za-z0-9]+)*" spellCheck={false} disabled={busy} value={apiName} onChange={event => { setCustomApiName(true); setApiName(event.target.value); }} /></label>
        <label className="sf-login-field">Purpose <small>Optional</small><textarea className="sf-input" rows={3} maxLength={4000} placeholder="Help customers with their questions…" disabled={busy} value={purpose} onChange={event => setPurpose(event.target.value)} /></label>
        {destination && <p className="sf-muted" style={{ overflowWrap: 'anywhere' }}>Saved in {destination.directory}/{apiName || 'Your_Agent'}{destination.initializesProject ? ' · Creates an Agentforce project folder here.' : ''}</p>}
        {error && <p className="sf-login-error" role="alert">{error}</p>}
      </div>
      <div className="sf-login-footer"><p>Saved locally. Publish when you’re ready.</p><div className="sf-login-buttons"><button type="button" className="sf-btn quiet" disabled={busy} onClick={onClose}>Cancel</button><button className="sf-btn primary" disabled={busy || !destination || !name.trim() || !apiName}>{busy ? 'Creating…' : 'Create agent'}</button></div></div>
    </form>
  </dialog>;
}
