import { useEffect, useRef, useState } from 'react';
import { MachineEnvironmentSaveSchema, MachineEnvironmentSettingsSchema, type MachineEnvironmentSettings as Snapshot } from '@zana-ai/zcc-contracts/host-rpc';
import { Section } from '../../components/settings/FormFields.js';
import { primaryHost, useHosts } from '../../hooks/useHosts.js';
import { apiJson } from '../../lib/fetch-with-app-surface.js';
import './machine-environment-settings.css';

export function MachineEnvironmentSettings() {
  const hosts = useHosts();
  const [selected, setSelected] = useState<string>();
  const hostId = selected ?? primaryHost(hosts)?.id;
  const host = hosts.find((item) => item.id === hostId);
  return <Section searchId="harness.environment" anchorId="harness-environment" title="API keys and environment" help="Save variables for chat providers and terminals on one machine. Credentials are never forwarded to your other machines.">
    <div className="machine-env" aria-label="API keys and environment">
      <label className="machine-env-machine">Machine <select aria-label="Environment machine" value={hostId ?? ''} onChange={(event) => setSelected(event.target.value)}>
        {!host ? <option value={hostId ?? ''}>{hostId ? 'Machine unavailable' : 'Select a machine'}</option> : null}
        {hosts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.status !== 'connected' ? ' · disconnected' : ''}</option>)}
      </select></label>
      <MachineEnvironmentForm key={hostId ?? ''} hostId={hostId} connected={host?.status === 'connected'} />
    </div>
  </Section>;
}

export function MachineEnvironmentForm({ hostId, connected }: { hostId?: string; connected: boolean }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [visible, setVisible] = useState(false);
  const [remove, setRemove] = useState<string>();
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const mutation = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const path = `/system/machines/${encodeURIComponent(hostId ?? '')}/environment`;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setSnapshot(null); setError(''); setNotice(''); setRemove(undefined);
    setLoading(false);
    if (!connected || !hostId) return;
    setLoading(true);
    void apiJson<{ hostId: string } & Snapshot>(path, { signal: controller.signal }).then((next) => {
      if (controller.signal.aborted) return;
      if (next.hostId !== hostId) throw new Error('Unexpected machine');
      setSnapshot(MachineEnvironmentSettingsSchema.parse(next));
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not load environment settings. Reconnect or update the machine, then reload.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [hostId, connected, reload, path]);

  const save = async (variable: string, replacement: string | null) => {
    if (!snapshot || !connected || mutation.current) return;
    const parsed = MachineEnvironmentSaveSchema.safeParse({ name: variable, value: replacement, expectedRevision: snapshot.revision });
    if (!parsed.success || replacement === '') { setError('Enter an uppercase variable name and a nonempty value. System and executable-control variables are reserved.'); return; }
    mutation.current = true; setSaving(true); setError(''); setNotice('');
    try {
      // A write may finish after navigation. Do not abort/retry it; its machine is fixed in this URL.
      const next = await apiJson<{ hostId: string } & Snapshot>(path, { method: 'PUT', body: JSON.stringify(parsed.data) });
      if (!mounted.current) return;
      if (next.hostId !== hostId) throw new Error('Unexpected machine');
      setSnapshot(MachineEnvironmentSettingsSchema.parse(next));
      setValue(''); setName(''); setVisible(false); setRemove(undefined);
      setNotice(replacement === null ? 'Saved variable removed. New sessions use the machine’s existing configuration.' : 'Variable saved. New chat conversations and machine terminals use the updated environment.');
    } catch {
      if (mounted.current) {
        setError('Could not confirm the change. Reload settings to check whether it was saved before trying again.');
        setSnapshot(null);
      }
    } finally { mutation.current = false; if (mounted.current) setSaving(false); }
  };
  const disabled = !snapshot || !connected || loading || saving;
  return <>
    <p className="settings-help">Values are encrypted on this machine and stay hidden after saving. Existing machine environment takes priority. Provider configuration, gateway URLs and credential helpers are preserved.</p>
    {!connected ? <p role="status" className="settings-help">Connect this machine to manage its variables.</p> : null}
    {loading ? <p role="status">Loading environment…</p> : null}
    {error ? <p role="alert" className="settings-help">{error}</p> : null}
    <button type="button" className="settings-btn" disabled={!connected || loading || saving} onClick={() => setReload((count) => count + 1)}>Reload variables</button>
    {snapshot ? <ul className="machine-env-list" aria-label="Saved environment variables">
      {snapshot.variables.map((row) => <li key={row.name}>
        <div><code>{row.name}</code><span aria-label="Value hidden">••••••••</span><span className="settings-help">{row.overriddenByEnvironment ? 'Machine environment takes priority' : 'Saved on this machine'}</span></div>
        {remove === row.name ? <div role="group" aria-label={`Remove ${row.name}`}><span>Remove saved value?</span><button className="settings-btn" disabled={disabled} onClick={() => { void save(row.name, null); }}>Remove variable</button><button className="settings-btn" disabled={saving} onClick={() => setRemove(undefined)}>Cancel</button></div>
          : <div><button type="button" className="settings-btn" disabled={disabled} onClick={() => { setName(row.name); setValue(''); setVisible(false); input.current?.focus(); }}>Replace <span className="sr-only">{row.name}</span></button><button type="button" className="settings-btn" disabled={disabled} onClick={() => setRemove(row.name)}>Remove <span className="sr-only">{row.name}</span></button></div>}
      </li>)}
      {!snapshot.variables.length ? <li className="settings-help">No variables saved here. Existing CLI logins and machine credentials still work.</li> : null}
    </ul> : null}
    <form className="machine-env-form" onSubmit={(event) => { event.preventDefault(); void save(name, value); }}>
      <label>Variable name<input aria-label="Environment variable name" value={name} disabled={disabled} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={128} placeholder="PROVIDER_API_KEY" onChange={(event) => setName(event.target.value)} /></label>
      <label>Value<input ref={input} aria-label="Environment variable value" value={value} disabled={disabled} type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} maxLength={8192} placeholder="Enter API key or value" onChange={(event) => setValue(event.target.value)} /></label>
      <button type="button" className="settings-btn" disabled={disabled} aria-pressed={visible} onClick={() => setVisible((shown) => !shown)}>{visible ? 'Hide value' : 'Show value'}</button>
      <button className="settings-btn" disabled={disabled || !name || !value}>{saving ? 'Saving…' : snapshot?.variables.some((row) => row.name === name) ? 'Replace variable' : 'Save variable'}</button>
    </form>
    {notice ? <p className="settings-help" role="status">{notice}</p> : null}
    <p className="settings-help">Running conversations keep their current credentials. Remove a saved variable to return to the machine’s existing configuration.</p>
    <p className="settings-help">Use your provider’s documented variable name. Some providers also require API-key login through their CLI. Desktop CLI Agent overrides remain in their existing configuration.</p>
  </>;
}
