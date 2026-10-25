import { useEffect, useRef, useState } from 'react';
import { product } from '../../lib/product-client.js';
import { ipcErrorMessage } from '../../lib/ipc-error.js';

export function SharedInstancePicker({ onOpened }: { onOpened?(): void }) {
  const [instances, setInstances] = useState<Awaited<ReturnType<typeof product.sharedClient.list>>>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
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
        const message = ipcErrorMessage(err, 'Could not open another Zana. Try again.');
        if (message.includes('Sign in to your Zana account')) { setLoaded(false); setInstances([]); }
        else setError(message);
      }
    } finally { if (mounted.current) { setBusy(false); setSigningIn(false); } }
  }
  useEffect(() => {
    mounted.current = true;
    void run(load);
    return () => { mounted.current = false; };
  }, []);
  return <section aria-label="Zana instances" className="shared-instance-picker" data-settings-target="remote-access.shared-instance">
    <p>Open a Zana you already use. Its projects, threads and machines stay together.</p>
    {busy && !signingIn && !loaded && <p role="status">Checking your Zana instances…</p>}
    {signingIn && <p role="status">Finish signing in in your browser. Your instances will appear here automatically.</p>}
    {loaded && !instances.length && <p>No Zana instances found. Enable Remote access on the computer you want to open.</p>}
    {!!instances.length && <ul className="shared-instance-list">{instances.map(instance => <li key={instance.id}>
      <div><strong>{instance.name}</strong><code>{instance.url}</code><span>{instance.online ? 'Online' : 'Offline'}</span></div>
      <button type="button" className="btn" disabled={busy || !instance.online} onClick={() => void run(async () => { await product.sharedClient.select(instance.id); if (mounted.current) onOpened?.(); })}>Open Zana</button>
    </li>)}</ul>}
    <div className="shared-instance-actions">
      {!loaded && !busy && <button type="button" className="btn primary" onClick={() => void run(async () => { setSigningIn(true); await product.sharedClient.signIn(); if (mounted.current) await load(); })}>Sign in to browse Zanas</button>}
      {(loaded || error) && <button type="button" className="btn" disabled={busy} onClick={() => void run(load)}>{error ? 'Try again' : 'Refresh instances'}</button>}
    </div>
    <p className="settings-help">Your local projects and running agents keep working on this computer. To add somewhere to run work in the Zana you open, use its Machines settings.</p>
    {error && <p role="alert">{error}</p>}
  </section>;
}
