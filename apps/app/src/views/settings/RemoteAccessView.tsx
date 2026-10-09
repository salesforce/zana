import { SharedPreviews } from './SharedPreviews.js';
import { SharedInstancePicker } from './SharedInstancePicker.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink, Smartphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { ConnectCodePairing } from './ConnectCodePairing.js';
import { ToggleSwitch } from '../../components/settings/FormFields.js';
import { SearchTarget } from './MachineCard.js';
import './remote-access.css';

type Status = Awaited<ReturnType<typeof product.mobile.status>>;
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Could not update remote access. Try again.';

export function RemoteAccessView({ config, onConfigDraft }: {
  config: AppConfig;
  onConfigDraft(config: AppConfig): void;
}) {
  const desktop = hasDesktopBridge();
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [browserUrl, setBrowserUrl] = useState<string | null>(null);
  const [addressError, setAddressError] = useState('');
  const [copied, setCopied] = useState(false);
  const [disconnected, setDisconnected] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await product.mobile.status();
      if (request === generation.current) { setStatus(next); setStatusError(''); }
    } catch {
      if (request === generation.current) { setStatus(null); setStatusError('Could not read connection status. Try again.'); }
    }
  }, []);
  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      await refresh();
      if (!cancelled) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { cancelled = true; ++generation.current; clearTimeout(timer); };
  }, [desktop, refresh]);

  const linked = status?.connection?.mode === 'connect';
  const accountUrl = linked ? status.connection?.accountUrl : undefined;
  const serverUrl = linked ? status.connection?.publicUrl : undefined;
  useEffect(() => {
    setBrowserUrl(null); setAddressError(''); setCopied(false);
    if (!accountUrl) return;
    let cancelled = false;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const url = await product.mobile.browserAddress();
        if (!cancelled) { setBrowserUrl(url); setAddressError(''); }
      } catch (err) {
        if (!cancelled) { setBrowserUrl(null); setAddressError(errorText(err)); }
      } finally { loading = false; }
    };
    void load();
    window.addEventListener('focus', load);
    const timer = setInterval(() => void load(), 15_000);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [accountUrl, serverUrl]);

  const enabled = config.mobileGatewayEnabled === true;
  const connected = linked && enabled && status?.running && status.relayState === 'connected';
  const updateEnabled = async (value: boolean) => {
    const next = await product.config.set({ mobileGatewayEnabled: value });
    onConfigDraft(next);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await refresh(); }
    catch (err) { setError(errorText(err)); }
    finally { setBusy(false); }
  };

  if (!desktop) return <section className="remote-access-card">
    <Smartphone size={24} aria-hidden="true" />
    <h2>Remote access is managed on your computer</h2>
    <p>Open Zana on the computer you want to reach, then choose Remote access beside the bug icon. Sign in with the same account when you open its address in a browser.</p>
    <SharedPreviews />
  </section>;

  return <section className="remote-access-card" aria-label="Remote access setup">
    <header className="remote-access-heading"><Smartphone size={32} aria-hidden="true" />
      <div><h1>Remote access</h1><p>Publish this Zana instance at your-name.zana-ide.com, or open an existing instance below.</p></div>
      <ToggleSwitch searchId="remote-access.toggle" label="Remote access" checked={linked && enabled} disabled={busy || !linked || !!statusError} onChange={value => void run(() => updateEnabled(value))} />
    </header>
    {disconnected && !linked && <p className="remote-access-flash" role="status"><Check size={16} aria-hidden="true" /> Remote access disconnected</p>}
    {statusError ? <p role="alert">{statusError}</p> : !status ? <p role="status">Checking connection…</p> : !linked ? <>
      {status.error && status.connection?.mode !== 'unconfigured' && <p role="alert">{status.error}</p>}
      <SearchTarget searchId="remote-access.connect-code" block><ConnectCodePairing onPaired={async () => {
        setDisconnected(false);
        try { await updateEnabled(true); }
        catch (err) { setError(errorText(err)); }
        await refresh();
      }} /></SearchTarget>
    </> : <>
      <p className="remote-access-status" role="status">
        <span className={`remote-access-dot${connected ? ' connected' : ''}`} aria-hidden="true" />
        {connected ? 'Connected' : !enabled ? 'Remote access is off' : status.error ? 'Connection needs attention' : status.relayState === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}
      </p>
      {status.error && <p role="alert">{status.error}</p>}
      <SearchTarget searchId="remote-access.browser-address" block>
      {browserUrl ? <div className="remote-access-address">
        <span>Your browser address</span><code>{browserUrl}</code>
        <div className="remote-access-actions">
          {connected && <a className="btn primary" href={browserUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} aria-hidden="true" /> Open Zana</a>}
          <button type="button" className="btn" onClick={() => {
            setCopied(false); setError('');
            void navigator.clipboard.writeText(browserUrl).then(() => setCopied(true)).catch(() => setError('Could not copy the address. Select it above to copy manually.'));
          }}><Copy size={14} aria-hidden="true" /> {copied ? 'Copied' : 'Copy address'}</button>
        </div>
      </div> : <div className="remote-access-address">
        <strong>Pick your address</strong>
        <p>Choose a permanent name such as <code>your-name.zana-ide.com</code> on your account page, then return here.</p>
        <a className="btn" href={`${accountUrl}/connect/`} target="_blank" rel="noreferrer">Choose your address <ExternalLink size={14} aria-hidden="true" /></a>
      </div>}
      </SearchTarget>
      {addressError && <p role="alert">{addressError}</p>}
      <SearchTarget searchId="remote-access.account-links" block>
      <div className="remote-access-actions">
        <a className="btn" href={`${accountUrl}/connect/`} target="_blank" rel="noreferrer">Manage account</a>
        <Link className="btn" to="/settings/phone">Add a phone</Link>
        <Link className="btn" to="/settings/machines">Add an execution machine</Link>
      </div>
      </SearchTarget>
      <p className="settings-help">Keep this computer awake and Zana running. Sign in to your account to open its address. Turning access off also disconnects paired phones until you enable it again.</p>
      {confirmDisconnect ? <div className="remote-access-disconnect">
        <p>Disconnect this computer from your account? Browser and phone access will stop. You can sign in again later.</p>
        <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void run(async () => {
          // Stop the shared gateway before forgetting Connect. Disconnection
          // leaves this computer unconfigured and offline.
          await updateEnabled(false);
          await product.mobile.disconnectAccount();
          setConfirmDisconnect(false);
          setDisconnected(true);
        })}>Disconnect this computer</button>
        <button type="button" className="btn" disabled={busy} onClick={() => setConfirmDisconnect(false)}>Cancel</button>
      </div> : <button type="button" className="btn" disabled={busy} onClick={() => setConfirmDisconnect(true)}>Disconnect…</button>}
    </>}
    <SearchTarget searchId="remote-access.shared-instance" block><details className="remote-access-advanced"><summary>Open an existing Zana instead</summary><SharedInstancePicker /></details></SearchTarget>
    {error && <p role="alert">{error}</p>}
    {statusError && <button type="button" className="btn" onClick={() => void refresh()}>Try again</button>}
    <SharedPreviews />
  </section>;
}
