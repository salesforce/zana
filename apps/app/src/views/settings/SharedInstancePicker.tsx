import { useEffect, useRef, useState } from 'react';
import { product } from '../../lib/product-client.js';
import { ipcErrorMessage } from '../../lib/ipc-error.js';
import { computerLabel } from '@zana-ai/zcc-domain/computer-label';

export function SharedInstancePicker({ onOpened }: { onOpened?(): void }) {
  const [instances, setInstances] = useState<Awaited<ReturnType<typeof product.sharedClient.list>>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const mounted = useRef(false);
  async function load() {
    const next = await product.sharedClient.list();
    if (mounted.current) { setInstances(next); setLoaded(true); }
  }
  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await action(); }
    catch (err) {
      if (mounted.current) {
        const message = ipcErrorMessage(err, 'Could not open this computer. Try again.');
        if (message.includes('Sign in to your Zana account')) { setLoaded(false); setInstances([]); }
        else setError(message);
      }
    } finally { if (mounted.current) { setBusy(false); setSigningIn(false); setOpening(null); } }
  }
  useEffect(() => {
    mounted.current = true;
    void run(load);
    return () => { mounted.current = false; };
  }, []);
  return <section aria-label="Zana instances" className="shared-instance-picker" data-settings-target="remote-access.shared-instance">
    <p>Choose a computer to open its projects and agents. Your work on this computer keeps running.</p>
    {busy && !signingIn && !loaded && <p role="status">Checking your computers…</p>}
    {signingIn && <p role="status">Finish signing in in your browser. Your computers will appear here automatically.</p>}
    {opening && <p role="status">Connecting to {computerLabel(instances.find(instance => instance.id === opening)!.name)}…</p>}
    {loaded && !instances.length && <p>No computers found. Enable Remote access on the computer you want to open.</p>}
    {!!instances.length && <ul className="shared-instance-list">{instances.map(instance => <li key={instance.id}>
      <div><strong title={instance.name}>{computerLabel(instance.name)}</strong><code>{instance.url}</code><span>{instance.online ? 'Online' : 'Offline · Keep this computer awake and Zana running.'}</span></div>
      <button type="button" className="btn" disabled={busy || !instance.online} onClick={() => { setOpening(instance.id); void run(async () => { await product.sharedClient.select(instance.id); if (mounted.current) onOpened?.(); }); }}>{opening === instance.id ? 'Connecting…' : 'Open computer'}</button>
    </li>)}</ul>}
    <div className="shared-instance-actions">
      {!loaded && !busy && <button type="button" className="btn primary" onClick={() => void run(async () => { setSigningIn(true); await product.sharedClient.signIn(); if (mounted.current) await load(); })}>Sign in to find your computers</button>}
      {(loaded || error) && <button type="button" className="btn" disabled={busy} onClick={() => void run(load)}>{error ? 'Try again' : 'Refresh computers'}</button>}
    </div>
    <p className="settings-help">Use “Return to this computer” in the computer menu to come back to your local tabs and work.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
