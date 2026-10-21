import { useEffect, useRef, useState } from 'react';
import { CONNECT_ACCESS_REVOKED_MESSAGE } from '@zana-ai/zcc-domain/product';
import { ipcErrorMessage } from '../../lib/ipc-error.js';
import { product } from '../../lib/product-client.js';

type Status = Awaited<ReturnType<typeof product.mobile.status>>;
export function PhoneAccountConnection({ status, onSaved, browserAccess = false, revoked = false }: { status: Status | null; onSaved(): Promise<void>; browserAccess?: boolean; revoked?: boolean }) {
  const [address, setAddress] = useState(status?.connection?.accountUrl ?? 'https://zana-ide.com');
  const [pending, setPending] = useState<{ verificationUrl: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connected = status?.connection?.mode === 'connect';
  const saved = useRef(onSaved);
  saved.current = onSaved;
  useEffect(() => {
    if (!pending) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (pending.expiresAt <= Date.now()) throw new Error('Sign-in expired. Start again.');
        const result = await product.mobile.pollEnrollment();
        if (cancelled) return;
        if (result.pending) timer = setTimeout(() => void poll(), 3000);
        else { setPending(null); await saved.current(); }
      } catch (err) { if (!cancelled) { setPending(null); setError(ipcErrorMessage(err, 'Could not connect')); } }
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pending]);
  const start = async () => {
    setBusy(true); setError('');
    try { const next = await product.mobile.enroll(address.trim()); setPending(next); window.open(next.verificationUrl, '_blank', 'noopener,noreferrer'); }
    catch (err) { setError(ipcErrorMessage(err, 'Could not start sign-in')); }
    finally { setBusy(false); }
  };
  const serviceField = <label className="settings-field">Connect service
    <input aria-label="Connect service" type="url" value={address} disabled={busy || !!pending} onChange={e => setAddress(e.target.value)} spellCheck={false} />
  </label>;
  return <div className="phone-account-connection">
    {!(revoked && connected && !pending) && <p className="settings-help">{browserAccess
      ? 'Sign in with GitHub and approve this computer. Then choose your personal browser address. Keep this computer awake and Zana running.'
      : 'Sign in with GitHub and approve this computer. Pair your phone once to choose any computer on your account, from any network. Keep the computer awake and Zana running.'}</p>}
    {connected && !pending && revoked ? <>
      <p role="alert">{CONNECT_ACCESS_REVOKED_MESSAGE}</p>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>Sign in again</button>
    </> : connected && !pending ? <>
      <p role="status">{status.running ? status.relayState === 'connected' ? 'Connected to your account' : 'Reconnecting to your account…' : 'Account linked. Enable phone access to connect.'}</p>
      <p className="settings-help">{status.connection?.publicUrl}</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void start()}>Sign in again</button>
      <button type="button" className="btn" disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void product.mobile.disconnectAccount().then(onSaved).catch(err => setError(ipcErrorMessage(err, 'Could not disconnect'))).finally(() => setBusy(false));
      }}>Disconnect this computer</button>
    </> : <>
      {browserAccess ? <details><summary>Advanced connection settings</summary>{serviceField}</details> : serviceField}
      {pending ? <>
        <p role="status">Approve this computer in your browser to finish connecting.</p>
        <a className="btn" href={pending.verificationUrl} target="_blank" rel="noreferrer">Open sign-in</a>
        <button type="button" className="btn" onClick={() => { void product.mobile.cancelEnrollment(); setPending(null); }}>Cancel</button>
      </> : <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>{busy ? 'Connecting…' : 'Sign in and connect'}</button>}
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
