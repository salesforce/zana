import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Copy, ExternalLink, Globe, Laptop, ShieldCheck, Smartphone } from 'lucide-react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { ipcErrorMessage, isConnectAccessRevoked } from '../../lib/ipc-error.js';
import { useHosts } from '../../hooks/useHosts.js';
import { Modal } from '../../components/Modal.js';
import { PhoneAccountConnection } from './PhoneAccountConnection.js';
import { ConnectCodePairing } from './ConnectCodePairing.js';
import { SharedPreviews } from './SharedPreviews.js';
import { SearchTarget } from './MachineCard.js';
import './remote-access.css';
import { computerLabel } from '@zana-ai/zcc-domain/computer-label';

type Status = Awaited<ReturnType<typeof product.mobile.status>>;
type Address = { key: string | null } & (
  | { kind: 'loading' }
  | { kind: 'ready'; url: string | null }
  | { kind: 'error'; message: string; revoked: boolean }
);
const errorText = (error: unknown) => ipcErrorMessage(error, 'Could not update remote access. Try again.');

export function RemoteAccessView({ config, onConfigDraft }: {
  config: AppConfig;
  onConfigDraft(config: AppConfig): void;
}) {
  const desktop = hasDesktopBridge();
  const hosts = useHosts();
  const computer = hosts.find(host => host.isPrimary)?.name ?? 'This computer';
  const [status, setStatus] = useState<Status | null>(null);
  const [statusError, setStatusError] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<'off' | 'unlink' | null>(null);
  const [address, setAddress] = useState<Address>({ key: null, kind: 'loading' });
  const [addressRevision, setAddressRevision] = useState(0);
  const [enrollment, setEnrollment] = useState<'setup' | 'revoked' | null>(null);
  const [copied, setCopied] = useState(false);
  const [unlinked, setUnlinked] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    try {
      const next = await product.mobile.status();
      if (request === generation.current) { setStatus(next); setStatusError(''); }
    } catch {
      if (request === generation.current) setStatusError('Could not read connection status. Try again.');
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
  const connectionKey = linked ? `${accountUrl}|${status.connection?.publicUrl}` : null;
  useEffect(() => {
    setAddress({ key: connectionKey, kind: 'loading' }); setCopied(false);
    if (!accountUrl || !desktop || enrollment) return;
    let cancelled = false;
    let loading = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      try {
        const url = await product.mobile.browserAddress();
        if (!cancelled) setAddress({ key: connectionKey, kind: 'ready', url });
      } catch (err) {
        if (!cancelled) setAddress({ key: connectionKey, kind: 'error', revoked: isConnectAccessRevoked(err), message: errorText(err) });
      } finally { loading = false; }
    };
    void load();
    window.addEventListener('focus', load);
    const timer = setInterval(() => void load(), 15_000);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener('focus', load); };
  }, [accountUrl, connectionKey, addressRevision, desktop, enrollment]);

  const currentAddress: Address = address.key === connectionKey ? address : { key: connectionKey, kind: 'loading' };
  const enabled = config.mobileGatewayEnabled === true;
  const revoked = (currentAddress.kind === 'error' && currentAddress.revoked) || isConnectAccessRevoked(new Error(status?.error ?? ''));
  const mode = enrollment ?? (statusError ? 'status-error' : !status ? 'loading' : !linked ? 'setup' : revoked ? 'revoked'
    : currentAddress.kind === 'loading' ? 'loading' : currentAddress.kind === 'error' ? 'address-error'
    : !currentAddress.url ? 'address' : !enabled ? 'off' : status.running && status.relayState === 'connected' && !status.error ? 'connected' : 'reconnecting');
  const browserUrl = currentAddress.kind === 'ready' ? currentAddress.url : null;
  const label = { setup: 'Not set up', loading: 'Checking…', revoked: 'Sign-in required', address: 'Setup incomplete', off: 'Off', connected: 'Ready', reconnecting: 'Reconnecting', 'address-error': 'Address unavailable', 'status-error': 'Status unavailable' }[mode];
  const setupStep = ['setup', 'revoked'].includes(mode) ? 0 : !browserUrl ? 1 : 2;
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
  const retryAddress = () => setAddressRevision(value => value + 1);
  const enrolled = async () => {
    setUnlinked(false);
    // Setup explicitly enables access. Repair retains the user's existing setting.
    if (mode === 'setup') {
      try { await updateEnabled(true); }
      catch (err) { setError(errorText(err)); }
    }
    retryAddress();
    await refresh();
  };

  if (!desktop) return <section className="remote-access-card">
    <Globe size={24} aria-hidden="true" />
    <h2>Remote access is managed on your computer</h2>
    <p>Open Zana on the computer you want to reach and choose Remote access. Open its address in your phone’s browser and sign in with the same account.</p>
    <SharedPreviews />
  </section>;

  return <section className="remote-access-card" aria-label="Remote access setup">
    <header className="remote-access-heading"><div><span className="remote-access-eyebrow">This computer</span>
      <h1>Remote access</h1><p>Use this computer’s Zana from your phone or another browser.</p></div></header>
    {unlinked && !linked && <p className="remote-access-flash" role="status"><Check size={16} aria-hidden="true" /> Computer unlinked. Your local work keeps running.</p>}
    <section className="remote-access-connection" aria-label="This computer’s remote access">
      <div className="remote-access-computer"><span className="remote-access-computer-icon"><Laptop size={21} aria-hidden="true" /></span>
        <div><strong title={computer}>{computerLabel(computer)}</strong><small>{computerLabel(computer) !== computer ? computer : 'Projects and agents run on this computer'}</small></div>
        <span role="status" className={`remote-access-badge ${mode === 'connected' ? 'connected' : ['revoked', 'reconnecting', 'address-error', 'status-error'].includes(mode) ? 'attention' : ''}`}><span aria-hidden="true" />{label}</span>
        {['connected', 'reconnecting'].includes(mode) && <SearchTarget searchId="remote-access.toggle"><button type="button" className="remote-access-quiet" disabled={busy} onClick={() => setConfirmation('off')}>Turn off</button></SearchTarget>}
      </div>
      {!['loading', 'status-error'].includes(mode) && <ol className="remote-access-progress" aria-label="Remote access setup progress">
        {['Sign in', 'Choose address', 'Connect'].map((step, index) => <li key={step} aria-current={mode !== 'connected' && index === setupStep ? 'step' : undefined} className={mode === 'connected' || index < setupStep ? 'complete' : ''}><span aria-hidden="true">{mode === 'connected' || index < setupStep ? <Check size={12} /> : index + 1}</span>{step}</li>)}
      </ol>}
      <div className="remote-access-body">
        {mode === 'loading' && <><h2>Checking remote access…</h2><p className="settings-help">Checking this computer’s account connection and browser address.</p></>}
        {mode === 'status-error' && <><h2>We couldn’t check remote access</h2><p role="alert">{statusError}</p><button type="button" className="btn" onClick={() => void refresh()}>Try again</button></>}
        {mode === 'setup' && <SearchTarget searchId="remote-access.connect-code" block>
          <h2>Enable access to this computer</h2><p className="settings-help">Sign in, choose a private browser address, then connect this computer. Open its address from another device to use these projects and agents.</p>
          {status?.error && <p role="alert">{status.error}</p>}
          <PhoneAccountConnection status={status} onSaved={enrolled} browserAccess onActivity={active => setEnrollment(active ? 'setup' : null)} />
          <details className="remote-access-advanced"><summary>Have a connect code?</summary><ConnectCodePairing onPaired={enrolled} /></details>
        </SearchTarget>}
        {mode === 'revoked' && <div className="remote-access-recovery"><h2>Reconnect this computer</h2>
          <PhoneAccountConnection status={status} onSaved={enrolled} browserAccess revoked onActivity={active => setEnrollment(active ? 'revoked' : null)} />
          <p className="settings-help">{enabled ? 'Remote access will resume after you sign in.' : 'Remote access will stay off until you turn it on.'}</p>
        </div>}
        {mode === 'address-error' && <><h2>We couldn’t load your address</h2><p className="settings-help">Your account is connected. Try again to check your saved browser address.</p><p role="alert">{currentAddress.kind === 'error' && currentAddress.message}</p><button type="button" className="btn primary" onClick={retryAddress}>Try again</button></>}
        {mode === 'address' && <SearchTarget searchId="remote-access.browser-address" block><h2>Choose your browser address</h2><p className="settings-help">Account connected. Setup is not finished: choose an address for this computer, then return here to check the connection.</p><a className="btn primary" href={`${accountUrl}/connect/?server=${encodeURIComponent(status?.connection?.serverId ?? '')}#address`} target="_blank" rel="noreferrer">Choose address <ExternalLink size={14} aria-hidden="true" /></a></SearchTarget>}
        {mode === 'off' && <><h2>Remote access is off</h2><p className="settings-help">Turn it on to reach this computer from your phone or another browser. Your account is still connected.</p><SearchTarget searchId="remote-access.toggle"><button type="button" className="btn primary" disabled={busy} onClick={() => void run(() => updateEnabled(true))}>Turn on remote access</button></SearchTarget></>}
        {mode === 'reconnecting' && <><h2>Reconnecting…</h2><p className="settings-help">We’re trying to reconnect automatically. Your projects and agents keep running on this computer.</p>{status?.error && <p role="alert">{status.error}</p>}</>}
        {mode === 'connected' && <h2>{computerLabel(computer)} is ready</h2>}
        {browserUrl && ['connected', 'off', 'reconnecting'].includes(mode) && <SearchTarget searchId="remote-access.browser-address" block>
          <div className={`remote-access-address${mode !== 'connected' ? ' unavailable' : ''}`}>
            <span>{mode === 'connected' ? 'Your address · open from any device' : 'Saved address · currently unavailable'}</span><code>{browserUrl}</code>
            {mode === 'connected' && <div className="remote-access-actions"><button type="button" className="btn primary" onClick={() => {
              setCopied(false); setError('');
              void navigator.clipboard.writeText(browserUrl).then(() => setCopied(true)).catch(() => setError('Could not copy the address. Select it above to copy manually.'));
            }}><Copy size={14} aria-hidden="true" />{copied ? 'Copied' : 'Copy address'}</button><a className="btn" href={browserUrl} target="_blank" rel="noreferrer">Open in browser <ExternalLink size={14} aria-hidden="true" /></a></div>}
          </div>
        </SearchTarget>}
        {mode === 'connected' && <SearchTarget searchId="phone.browser-guide" block><details className="remote-access-phone" id="phone"><summary><Smartphone size={15} aria-hidden="true" />Use on your phone<ChevronRight size={13} aria-hidden="true" /></summary><ol aria-label="Mobile browser setup"><li>Open <strong>{browserUrl}</strong> in your phone’s browser.</li><li>Sign in with the same GitHub account to open this Zana.</li></ol></details></SearchTarget>}
      </div>
      {linked && ['connected', 'off', 'reconnecting', 'address-error'].includes(mode) && <SearchTarget searchId="remote-access.account-links" block><footer className="remote-access-account"><span>Account connected</span><a href={`${accountUrl}/connect/`} target="_blank" rel="noreferrer">Manage account <ExternalLink size={12} aria-hidden="true" /></a></footer></SearchTarget>}
    </section>
    <p className="remote-access-scope"><ShieldCheck size={15} aria-hidden="true" />Keep this computer awake and Zana running. Remote access requires your Zana account.</p>
    {linked && <details className="remote-access-options"><summary>Connection options</summary><p className="settings-help">Remove this computer’s saved account connection.</p><button type="button" className="remote-access-quiet danger" disabled={busy || !!enrollment} onClick={() => setConfirmation('unlink')}>Unlink this computer…</button></details>}
    {confirmation && <Modal title={confirmation === 'off' ? 'Turn off remote access?' : 'Unlink this computer?'} onClose={() => { if (!busy) setConfirmation(null); }} closeOnBackdrop={!busy} footer={<><button type="button" className="btn" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button type="button" className={`btn ${confirmation === 'unlink' ? 'btn--danger' : 'primary'}`} disabled={busy} onClick={() => void run(async () => {
      await updateEnabled(false);
      if (confirmation === 'unlink') { await product.mobile.disconnectAccount(); setUnlinked(true); }
      setConfirmation(null);
    })}>{confirmation === 'off' ? 'Turn off' : 'Unlink computer'}</button></>}>
      <p>{confirmation === 'off' ? 'Browser and phone access will stop until you turn it on again. This computer stays connected to your account.' : 'Remote access will stop and this computer’s saved account connection will be removed. Your local projects and running work stay on this computer.'}</p>
      {error && <p role="alert">{error}</p>}
    </Modal>}
    {error && !confirmation && <p role="alert">{error}</p>}
    <SharedPreviews available={mode === 'connected'} />
  </section>;
}
