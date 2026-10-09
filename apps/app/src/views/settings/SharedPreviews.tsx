import { useCallback, useEffect, useState } from 'react';
import type { PreviewList, PreviewView } from '@zana-ai/zcc-contracts/previews';
import { apiJson } from '../../lib/fetch-with-app-surface.js';
import { getDesktopBrowserApi } from '../../lib/desktop-browser.js';
import { hasDesktopBridge } from '../../lib/app-surface.js';
import { ThreadBrowserTab } from '../../components/thread/secondary-panel/ThreadBrowserTab.js';
import './shared-previews.css';

const labels: Record<PreviewView['status'], string> = { ready: 'Ready', connecting: 'Connecting…', offline: 'Machine offline', 'server-not-responding': 'Start your dev server', 'update-required': 'Update required', disabled: 'Remote access is off' };
/** Settings-search target (a bare section, not a FormFields primitive). */
const SHARED_PREVIEWS_TARGET = { searchId: 'remote-access.shared-previews' };

export function SharedPreviews() {
  const [data, setData] = useState<PreviewList>();
  const [hosts, setHosts] = useState<Array<{ id: string; name: string }>>([]);
  const [hostId, setHostId] = useState('');
  const [port, setPort] = useState(() => {
    const candidate = new URLSearchParams(window.location.search).get('previewPort') ?? '';
    return /^[1-9]\d{3,4}$/.test(candidate) && Number(candidate) >= 1024 && Number(candidate) <= 65535 ? candidate : '';
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState<string>();
  const [copied, setCopied] = useState<string>();
  useEffect(() => { if (opened) return () => getDesktopBrowserApi()?.detach(`shared-preview:${opened}`); }, [opened]);
  const refresh = useCallback(async () => {
    const [next, machines] = await Promise.all([apiJson<PreviewList>('/previews'), apiJson<Array<{ id: string; name: string }>>('/hosts')]);
    return { next, machines };
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const { next, machines } = await refresh(); if (!disposed) { setData(next); setHosts(machines); } }
      catch (err) { if (!disposed) setError(err instanceof Error ? err.message : 'Could not load previews'); }
      if (!disposed) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [refresh]);
  const change = async (method: 'POST' | 'DELETE', target: { port: number; hostId?: string }) => {
    setBusy(true); setError('');
    try { setData(await apiJson<PreviewList>('/previews', { method, body: JSON.stringify(target) })); if (method === 'POST') setPort(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not update preview'); }
    finally { setBusy(false); }
  };
  return <section className="shared-previews" aria-labelledby="shared-previews-title" data-settings-target={SHARED_PREVIEWS_TARGET.searchId}>
    <h2 id="shared-previews-title">Shared previews</h2>
    <p>Open a running web app on your phone or another computer. Each address requires your Connect account. Shares expire after eight hours; sharing again renews them.</p>
    {!data ? <p role="status">Loading previews…</p> : <>
      {!data.enabled && <p>Turn on Remote access on the Zana computer to share a preview.</p>}
      <form className="shared-previews-form" onSubmit={event => { event.preventDefault(); void change('POST', { port: Number(port), ...(hostId ? { hostId } : {}) }); }}>
        <label>Machine<select value={hostId} onChange={event => setHostId(event.target.value)}><option value="">Zana computer</option>{hosts.map(host => <option key={host.id} value={host.id}>{host.name}</option>)}</select></label>
        <label>Port<input type="number" min={1024} max={65535} step={1} required placeholder="5173" value={port} onChange={event => setPort(event.target.value)} /></label>
        <button className="btn primary" disabled={busy || !data.enabled}>Share preview</button>
      </form>
      {!data.shares.length && <p>No shared previews.</p>}
      <ul className="shared-previews-list">{data.shares.map(share => <li key={`${share.hostId}:${share.port}`}>
        <strong>{share.hostName}:{share.port}</strong><span role="status">{labels[share.status]}</span>
        <small>Expires {new Date(share.expiresAt).toLocaleString()}</small>
        {share.message && <p>{share.message}</p>}
        {share.url ? <><code>{share.url}</code><div className="remote-access-actions">
          {hasDesktopBridge() ? <button className="btn" onClick={() => setOpened(share.url!)}>Open preview</button> : <a className="btn" href={share.url} target="_blank" rel="noreferrer">Open preview</a>}
          <button className="btn" onClick={() => void navigator.clipboard.writeText(share.url!).then(() => setCopied(share.url!)).catch(() => setError('Could not copy. Select the address to copy it manually.'))}>{copied === share.url ? 'Copied' : 'Copy address'}</button>
        </div></> : <p>Choose a browser address on your Connect account page.</p>}
        <button className="btn" disabled={busy} onClick={() => void change('DELETE', { hostId: share.hostId, port: share.port })}>Stop sharing {share.port}</button>
      </li>)}</ul>
    </>}
    {error && <p role="alert">{error}</p>}
    {opened && <section className="shared-preview-browser" aria-label="Shared preview browser"><button className="btn" onClick={() => setOpened(undefined)}>Close preview</button><ThreadBrowserTab key={opened} tabId={`shared-preview:${opened}`} threadId="shared-previews" initialUrl={opened} /></section>}
  </section>;
}
