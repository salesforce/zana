import { useEffect, useRef, useState } from 'react';
import { CONNECT_ACCESS_REVOKED_MESSAGE } from '@zana-ai/zcc-domain/product';
import { ipcErrorMessage } from '../../lib/ipc-error.js';
import { product } from '../../lib/product-client.js';

type Status = Awaited<ReturnType<typeof product.mobile.status>>;
export function PhoneAccountConnection({ status, onSaved, browserAccess = false, revoked = false, onActivity }: {
  status: Status | null;
  onSaved(): Promise<void>;
  browserAccess?: boolean;
  revoked?: boolean;
  onActivity?(active: boolean): void;
}) {
  const [address, setAddress] = useState(status?.connection?.accountUrl ?? 'https://zana-ide.com');
  const [pending, setPending] = useState<{ verificationUrl: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connected = status?.connection?.mode === 'connect';
  const callbacks = useRef({ onSaved, onActivity });
  callbacks.current = { onSaved, onActivity };
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!pending) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (pending.expiresAt <= Date.now()) throw new Error('Sign-in expired. Start again.');
        const result = await product.mobile.pollEnrollment();
        if (cancelled) return;
        if (result.pending) timer = setTimeout(() => void poll(), 3000);
        else {
          setBusy(true);
          await callbacks.current.onSaved();
          if (!cancelled) { setPending(null); setBusy(false); callbacks.current.onActivity?.(false); }
        }
      } catch (err) {
        if (!cancelled) { setPending(null); setBusy(false); setError(ipcErrorMessage(err, 'Could not connect')); callbacks.current.onActivity?.(false); }
      }
    };
    timer = setTimeout(() => void poll(), 3000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pending]);
  const start = async () => {
    setBusy(true); setError(''); callbacks.current.onActivity?.(true);
    try {
      const next = await product.mobile.enroll(address.trim());
      if (!mounted.current) return;
      setPending(next); window.open(next.verificationUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      if (mounted.current) { setError(ipcErrorMessage(err, 'Could not start sign-in')); callbacks.current.onActivity?.(false); }
    } finally { if (mounted.current) setBusy(false); }
  };
  const cancel = async () => {
    setBusy(true); setError('');
    try {
      await product.mobile.cancelEnrollment();
      if (mounted.current) { setPending(null); callbacks.current.onActivity?.(false); }
    } catch (err) { if (mounted.current) setError(ipcErrorMessage(err, 'Could not cancel sign-in')); }
    finally { if (mounted.current) setBusy(false); }
  };
  const serviceField = <label className="settings-field">Connect service
    <input aria-label="Connect service" type="url" value={address} disabled={busy || !!pending} onChange={e => setAddress(e.target.value)} spellCheck={false} />
  </label>;
  return <div className="phone-account-connection">
    {pending ? <>
      <p role="status">Approve this computer in your browser to finish connecting.</p>
      <div className="remote-access-actions"><a className="btn" href={pending.verificationUrl} target="_blank" rel="noreferrer">Open sign-in</a>
      <button type="button" className="btn" disabled={busy} onClick={() => void cancel()}>Cancel</button></div>
    </> : revoked ? <>
      <p role="alert">{CONNECT_ACCESS_REVOKED_MESSAGE}</p>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>Sign in again</button>
    </> : browserAccess ? <>
      <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>{busy ? 'Connecting…' : 'Set up remote access'}</button>
      <details className="remote-access-advanced"><summary>Advanced connection settings</summary>{serviceField}</details>
    </> : connected ? <>
      <p role="status">{status.running ? status.relayState === 'connected' ? 'Connected to your account' : 'Reconnecting to your account…' : 'Account linked. Enable remote access to connect.'}</p>
      <p className="settings-help">{status.connection?.publicUrl}</p>
      <button type="button" className="btn" disabled={busy} onClick={() => void start()}>Sign in again</button>
      <button type="button" className="btn" disabled={busy} onClick={() => {
        setBusy(true); setError('');
        void product.mobile.disconnectAccount().then(onSaved).catch(err => setError(ipcErrorMessage(err, 'Could not disconnect'))).finally(() => setBusy(false));
      }}>Disconnect this computer</button>
    </> : <>
      {serviceField}
      <button type="button" className="btn primary" disabled={busy} onClick={() => void start()}>{busy ? 'Connecting…' : 'Sign in and connect'}</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
