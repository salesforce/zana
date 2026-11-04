'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import styles from './connect.module.css';
import { SlackLink } from './SlackLink';
import { AddressPicker, BrowserLink, BrowserSignIn } from './BrowserAccess';
import { PhoneSignIn } from './PhoneSignIn';
import { DesktopSignIn } from './DesktopSignIn';
import { InstanceMachines } from './InstanceMachines';
import { ComputerCode } from './ComputerCode';
import { ComputerEnrollment, type Enrollment } from './ComputerEnrollment';

interface Computer { id: string; name: string; serverUrl: string; browserUrl?: string | null; paired?: boolean; live: boolean; revoked: boolean }
interface Device { id: string; label: string; revoked: boolean }
interface Account { user: { name: string }; domain?: string; servers: Computer[]; devices: Device[] }
const icons = {
  computer: <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M11 18h2M10 5h4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 6.1a8 8 0 0 1 13.2 3M4.7 14.9a8 8 0 0 0 13.2 3" /></>,
  arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  logout: <><path d="M9 4H5v16h4M10 12h11m-4-4 4 4-4 4" /></>,
  link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M13 17a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(0 -1) scale(.95)" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
};
function Icon({ name, className = '' }: { name: keyof typeof icons; className?: string }) {
  return <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}
function Panel({ title, count, icon, description, actions, children }: { title: string; count: number; icon: 'computer' | 'phone'; description: string; actions?: ReactNode; children: ReactNode }) {
  return <section className={styles.panel} aria-label={title}>
    <header className={styles.panelHeader}><span className={styles.panelIcon}><Icon name={icon} /></span><div><h2>{title} <span className={styles.count}>{count}</span></h2><p>{description}</p></div>{actions && <div className={styles.panelActions}>{actions}</div>}</header>
    {children}
  </section>;
}
class SignInRequired extends Error {}
async function api(path: string, body?: unknown) {
  const target = new URL(`/api/connect${path}`, window.location.origin);
  target.pathname = `${target.pathname.replace(/\/$/, '')}/`;
  const response = await fetch(target.pathname + target.search, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12_000), ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (response.status === 401) throw new SignInRequired();
  if (!response.ok && (path.startsWith('/address') || path.startsWith('/browser') || path.startsWith('/computer'))) {
    const problem = await response.json().catch(() => ({}));
    const messages: Record<string, string> = { already_connected: 'This computer is already registered. Refresh to see its status.', unknown_server: 'This computer is no longer available. Refresh your devices.', address_taken: 'That address is taken. Try another name.', reserved_address: 'That address is reserved. Choose another name.', invalid_address: 'Use 3–30 lowercase letters, numbers, and single dashes.', address_already_claimed: 'This computer already has a permanent address. Refresh to see it.', account_limit: 'Your account has reached its address limit.', not_your_server: 'This computer belongs to a different account. Sign in with the account that connected it.', expired_or_used: 'This browser sign-in expired or was already used. Open your computer’s address again.', invalid_browser_state: 'Open your computer’s address again in this browser.' };
    throw new Error(messages[problem.error] ?? 'Could not complete this action. Please try again.');
  }
  if (!response.ok) throw new Error(response.status === 503 ? 'Connect is not available on this service yet.' : response.status === 409 || response.status === 410 ? 'This approval has expired or was already used. Start again from the app where you began.' : 'Could not complete this action. Please try again.');
  return response.json();
}
export function ConnectAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [code, setCode] = useState('');
  const [addressServerId, setAddressServerId] = useState('');
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [phoneCode, setPhoneCode] = useState('');
  const [desktopCode, setDesktopCode] = useState('');
  const [browserCode, setBrowserCode] = useState('');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [setupOpen, setSetupOpen] = useState(false);
  const handleError = useCallback((err: unknown) => {
    if (err instanceof SignInRequired) { setAccount(null); setEnrollment(null); setSignIn(true); }
    else setError(err instanceof Error ? err.message : 'Could not complete this action.');
  }, []);
  const refresh = useCallback(async () => {
    setRefreshing(true); setError('');
    try {
      const value = await api('/account'); setAccount(value); setSignIn(false);
      const pending = new URL(window.location.href).searchParams.get('code') ?? '';
      setCode(pending);
      setAddressServerId(new URL(window.location.href).searchParams.get('server') ?? '');
      setPhoneCode(new URL(window.location.href).searchParams.get('phone') ?? '');
      setDesktopCode(new URL(window.location.href).searchParams.get('desktop') ?? '');
      setRefreshRevision(value => value + 1);
      setBrowserCode(new URL(window.location.href).searchParams.get('browser') ?? '');
      if (pending) setEnrollment(await api(`/device/info?code=${encodeURIComponent(pending)}`));
    } catch (err) { handleError(err); }
    finally { setRefreshing(false); }
  }, [handleError]);
  useEffect(() => { void refresh(); }, [refresh]);
  const action = async (path: string, body: unknown) => {
    setBusy(true); setError('');
    try { await api(path, body); await refresh(); }
    catch (err) { handleError(err); }
    finally { setBusy(false); }
  };
  const computers = account?.servers.filter(s => !s.revoked) ?? [];
  const setupServer = computers.find(server => server.id === (enrollment?.serverId ?? addressServerId));
  const setupEnrollment = enrollment ?? (addressServerId && setupServer ? { name: setupServer.name, approved: true, denied: false, serverId: setupServer.id } : null);
  useEffect(() => {
    if (!setupEnrollment?.approved || !setupServer?.browserUrl || setupServer.live || refreshing || busy || error
      || (enrollment?.expiresAt && enrollment.expiresAt <= Date.now())) return;
    const timer = setTimeout(() => void refresh(), 3000);
    return () => clearTimeout(timer);
  }, [setupEnrollment?.approved, setupServer?.browserUrl, setupServer?.live, refreshing, busy, error, enrollment?.expiresAt, refresh]);
  const devices = account?.devices.filter(d => !d.revoked) ?? [];
  const online = computers.filter(s => s.live).length;
  const disabled = busy || refreshing;
  return <div className={`wrap ${styles.dashboard}`}>
    <header className={styles.heading}>
      <div><h1>{code || addressServerId ? 'Set up remote access' : 'Your Zana'}</h1><p className={styles.subtitle}>{code || addressServerId ? 'Connect this computer, choose its address, and check when it’s ready.' : 'Your agents and projects, reachable anywhere.'}</p></div>
      {account && <form action="/api/auth/logout/" method="post"><button className="zcc-btn zcc-btn-ghost zcc-btn-sm" type="submit"><Icon name="logout" />Sign out</button></form>}
    </header>
    {error && <div className={styles.error} role="alert"><span>{error}</span><button className="zcc-btn" disabled={disabled} onClick={() => void refresh()}>Try again</button></div>}
    {!account && refreshing && <div className={styles.loading} role="status"><Icon name="refresh" className={styles.spinning} />Loading your devices…</div>}
    {signIn && <section className={styles.signIn} aria-labelledby="connect-sign-in">
      <div className={styles.deviceBridge} aria-hidden="true"><Icon name="computer" /><span /><Icon name="shield" /><span /><Icon name="phone" /></div>
      <h2 id="connect-sign-in">A home for your connected devices</h2><p>Sign in to connect your computers, pair your phone, and manage access in one place.</p>
      <a className="zcc-btn zcc-btn-primary" href={`/api/auth/github/login/?returnTo=${encodeURIComponent(typeof window === 'undefined' ? '/connect/' : `/connect/${window.location.search}`)}`}>Sign in with GitHub <Icon name="arrow" /></a>
      <small>Uses your GitHub profile. No repository access required.</small>
    </section>}
    {account && <>
      {desktopCode && <DesktopSignIn key={refreshRevision} code={desktopCode} api={api} onError={handleError} />}
      {!desktopCode && phoneCode && <PhoneSignIn key={refreshRevision} code={phoneCode} api={api} onError={handleError} />}
      {!desktopCode && !phoneCode && <>
      {browserCode && <BrowserSignIn code={browserCode} api={api} onError={handleError} />}
      {setupEnrollment && <ComputerEnrollment enrollment={setupEnrollment} computers={computers} domain={account.domain} api={api} disabled={disabled} onApprove={approved => void action('/device/approve', { code, approved })} onChanged={refresh} onError={handleError} />}
      {addressServerId && !setupEnrollment && <section role="alert"><h2>This computer is no longer available</h2><p>Return to Remote access in the desktop app and sign in again.</p></section>}
      {!code && !addressServerId && <>
      <div className={styles.instancePanel}>
        <Panel title="Zana instances" count={computers.length} icon="computer" description="Open your personal address to reach your agents and projects." actions={
          <button className="zcc-btn zcc-btn-ghost zcc-btn-sm" aria-label="Refresh" title="Refresh devices and execution machines" disabled={disabled} onClick={() => void refresh()}><Icon name="refresh" className={refreshing ? styles.spinning : ''} /><span>{refreshing ? 'Refreshing…' : 'Refresh'}</span></button>
        }>
          {computers.length === 0 ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name="computer" /></span><h3>Connect your first computer</h3><p>Keep your agents close, even when you’re away from your desk.</p><a className={styles.textLink} href="#connect-setup" onClick={() => setSetupOpen(true)}>See how to connect <Icon name="arrow" /></a></div> : <ul className={styles.deviceList}>{computers.map(server => <li key={server.id} className={`${styles.device} ${styles.instance}`}>
            <span className={styles.deviceIcon}><Icon name="computer" /></span><div className={styles.deviceInfo}><h3>{server.browserUrl ? <BrowserLink className={styles.domainLink} serverId={server.id} browserUrl={server.browserUrl} api={api} onError={handleError}><span>{server.browserUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span><Icon name="arrow" /></BrowserLink> : server.name}</h3>
            {server.browserUrl && <p className={styles.instanceHost}>{server.name}</p>}
            {!server.live && <p>{server.paired === false ? 'Address reserved. Paste its connect code in the desktop app.' : 'Open Zana on this computer to reconnect'}</p>}<InstanceMachines serverId={server.id} api={api} refreshRevision={refreshRevision} /></div><span className={`${styles.status} ${server.live ? styles.online : ''}`}><span />{server.live ? 'Online' : server.paired === false ? 'Not connected yet' : 'Offline'}</span>
            <button className={styles.remove} disabled={disabled} aria-label={`Disconnect computer ${server.name}`} onClick={() => void action('/revoke', { kind: 'server', id: server.id })}>Disconnect</button>
          </li>)}</ul>}
        </Panel>
      </div>
      {!browserCode && (computers.length > 0 && computers.every(server => server.paired !== false)
        ? <details className={styles.instanceSetup}><summary>Create a separate Zana instance <Icon name="chevron" className={styles.chevron} /></summary><ComputerCode api={api} onError={handleError} onChanged={refresh} domain={account.domain ?? 'zana-ide.com'} computers={computers} /></details>
        : <ComputerCode api={api} onError={handleError} onChanged={refresh} domain={account.domain ?? 'zana-ide.com'} computers={computers} />)}
      <SlackLink computers={computers} />
      {account.domain && !browserCode && <AddressPicker computers={computers} domain={account.domain} api={api} onChanged={refresh} onError={handleError} disabled={disabled} />}
      <dl className={styles.overview} aria-label="Device overview">
        <div><dt><Icon name="computer" />Computers</dt><dd>{computers.length}</dd></div>
        <div><dt><span className={styles.onlineDot} />Online now</dt><dd>{online}<span>{online === 0 ? 'None connected' : 'Ready to connect'}</span></dd></div>
        <div><dt><Icon name="phone" />Paired phones</dt><dd>{devices.length}</dd></div>
      </dl>
      <div className={styles.panels}>
        <Panel title="Paired phones" count={devices.length} icon="phone" description="Mobile devices with access to your computers.">
          {devices.length === 0 ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name="phone" /></span><h3>Your agents, on the go</h3><p>Open Zana Mobile, sign in with the same GitHub account, and choose your computer.</p><a className={styles.textLink} href="#connect-setup" onClick={() => setSetupOpen(true)}>How to pair a phone <Icon name="arrow" /></a></div> : <ul className={styles.deviceList}>{devices.map(device => <li key={device.id} className={styles.device}>
            <span className={styles.deviceIcon}><Icon name="phone" /></span><div className={styles.deviceInfo}><h3>{device.label}</h3><p>Access to computers on this account</p></div><span className={styles.status}><Icon name="link" />Paired</span>
            <button className={styles.remove} disabled={disabled} aria-label={`Revoke phone ${device.label}`} onClick={() => void action('/revoke', { kind: 'device', id: device.id })}>Revoke access</button>
          </li>)}</ul>}
        </Panel>
      <details id="connect-setup" className={styles.setup} open={setupOpen} onToggle={event => setSetupOpen(event.currentTarget.open)}>
        <summary><span className={styles.panelIcon}><Icon name="link" /></span><div><h2>Connect in three steps</h2><p>From your desk to your phone.</p></div><Icon name="chevron" className={styles.chevron} /></summary>
        <ol><li><span>1</span><div><h3>Open Zana on your computer</h3><p>Choose the computer that will keep your shared Zana running. Other computers join it from Settings → Machines.</p><a className={styles.textLink} href="/download/">Download Zana <Icon name="arrow" /></a></div></li><li><span>2</span><div><h3>Connect your account</h3><p>In the desktop app, open <strong>Settings → Remote access</strong> and paste the connect code above.</p></div></li><li><span>3</span><div><h3>Pair your phone</h3><p>Open <strong>Zana Mobile</strong>, continue with GitHub, approve your phone, and choose your computer. Works over Wi-Fi or cellular internet.</p></div></li></ol>
      </details>
      </div>
      </>}
      </>}
      <p className={styles.footnote}><Icon name="shield" />You’re in control. Disconnect a computer or revoke a phone’s access at any time.</p>
    </>}
  </div>;
}
