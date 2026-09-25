import { useEffect, useId, useRef, useState } from 'react';
import type { PluginCreateProjectDialogProps } from '@zana-ai/zcc-plugin-sdk/app';
import { parseOrgLoginInput, type OrgLoginInstance } from '../../lib/org-login.js';
import type { PublicListedOrg } from '../../lib/types.js';
import { OrgLoginFields } from './OrgLoginFields.js';
import { signInWithBrowser } from './org-login-rpc.js';
import { requireResult, useSalesforceCall } from './components/client.js';
import { SALESFORCE_STYLES } from './components/styles.js';
import { ArrowUpRight, CircleCheck } from './components/icons.js';

export function CreateSalesforceProjectDialog(props: PluginCreateProjectDialogProps) {
  const call = useSalesforceCall(props.pluginId);
  const folderId = useId();
  const [instance, setInstance] = useState<OrgLoginInstance>('production');
  const [url, setUrl] = useState('');
  const [alias, setAlias] = useState('');
  const [orgs, setOrgs] = useState<PublicListedOrg[]>([]);
  const [existing, setExisting] = useState(false);
  const [selected, setSelected] = useState('');
  const [connected, setConnected] = useState('');
  const [name, setName] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const login = useRef<AbortController | null>(null);
  // Keep completed local steps when a later step fails; retry must not generate
  // over an existing folder or create a second registered project.
  const created = useRef<{ path: string; projectId?: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    void props.cloneRoot().then(root => {
      if (alive.current && root) setOutputDir(current => current || root);
    }).catch(() => undefined);
    return () => { alive.current = false; login.current?.abort(); };
    // The host supplies fresh closures on render; initialize the folder once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (label: string, work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(label);
    setError(null);
    try { await work(); }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { pending.current = false; if (alive.current) setBusy(''); }
  };
  const choose = (value: string) => {
    setConnected(value);
    setError(null);
    setName(current => current || value.split('@')[0].replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+/, '').slice(0, 80) || 'salesforce-project');
  };
  const loadOrgs = () => run('Loading connected orgs…', async () => {
    setExisting(true);
    const result = requireResult<{ orgs: PublicListedOrg[] }>(await call('orgs'));
    if (alive.current) setOrgs(result.orgs);
  });
  const signIn = () => run('Waiting for sign-in…', async () => {
    const input = { instance, ...(instance === 'custom' ? { instanceUrl: url } : {}), alias: alias.trim() || undefined };
    const parsed = parseOrgLoginInput(input);
    if (!parsed.ok) throw Error(parsed.error);
    const controller = new AbortController();
    login.current = controller;
    const result = requireResult<{ connectedAlias?: string; orgs: PublicListedOrg[]; warning?: string }>(
      await signInWithBrowser(call, input, controller.signal),
    );
    if (!alive.current) return;
    setOrgs(result.orgs);
    if (result.connectedAlias) choose(result.connectedAlias);
    else {
      setExisting(true);
      throw Error(result.warning || 'Signed in. Choose your org from the connected list to continue.');
    }
  });
  const create = () => run('Creating project…', async () => {
    if (!created.current) {
      const result = requireResult<{ path: string }>(await call('project.generate', { name: name.trim(), outputDir: outputDir.trim() }));
      if (!result.path) throw Error('Salesforce CLI did not return a project folder.');
      created.current = { path: result.path };
    }
    if (!created.current.projectId) {
      const project = await props.addProject(created.current.path);
      if (!project) throw Error('The folder is ready, but could not be added to Projects. Retry to finish setup.');
      created.current.projectId = project.id;
    }
    requireResult(await call('project.connect', { projectId: created.current.projectId, selectedAlias: connected }));
    if (alive.current) {
      props.toProject(created.current.projectId, { tabId: 'salesforce' });
      props.close();
    }
  });

  return <div className="sf-surface sf-create-project" data-testid="salesforce-create-project">
    <style>{SALESFORCE_STYLES}</style>
    <ol className="sf-create-steps" aria-label="Project setup progress">
      <li aria-current={!connected ? 'step' : undefined}><span>{connected ? '✓' : '1'}</span>Log in to Salesforce</li>
      <li aria-current={connected ? 'step' : undefined}><span>2</span>Create your project</li>
    </ol>
    <form onSubmit={event => {
      event.preventDefault();
      if (connected) { if (name.trim() && outputDir.trim()) void create(); }
      else if (existing) { if (selected && !busy) choose(selected); }
      else void signIn();
    }}>
      <div className="sf-create-body">
        {!connected ? <>
          {existing ? <>
            <label className="sf-login-field">Connected org
              <select className="sf-select" value={selected} disabled={!!busy} onChange={event => setSelected(event.target.value)}>
                <option value="">Choose an org</option>
                {orgs.map(org => <option key={org.username} value={org.alias || org.username}>{org.alias || org.username} · {org.username}</option>)}
              </select>
            </label>
            {!busy && !orgs.length && <p className="sf-muted">No connected orgs yet. Log in to continue.</p>}
            <div><button type="button" className="sf-btn quiet" disabled={!!busy} onClick={() => { setExisting(false); setError(null); }}>Log in to another org</button>
              <button type="button" className="sf-btn quiet" disabled={!!busy} onClick={() => void loadOrgs()}>Refresh</button></div>
          </> : <>
            <OrgLoginFields instance={instance} url={url} alias={alias} busy={!!busy}
              onInstance={setInstance} onUrl={setUrl} onAlias={setAlias} />
            <button type="button" className="sf-btn quiet sf-create-shortcut" disabled={!!busy} onClick={() => void loadOrgs()}>Use a connected org</button>
          </>}
          {busy === 'Waiting for sign-in…' && <div className="sf-login-waiting" role="status"><span className="sf-login-spinner" aria-hidden="true" /><div><strong>Finish signing in in your browser</strong><span>We’ll continue here once you’re connected. No folder has been created yet.</span></div></div>}
        </> : <>
          <div className="sf-create-connected"><CircleCheck /><div><strong>{connected}</strong><small>Connected · default org for this project</small></div>
            <button type="button" className="sf-btn quiet" disabled={!!busy || !!created.current} onClick={() => { setConnected(''); setError(null); }}>Change org</button>
          </div>
          <label className="sf-login-field">Project name
            <input className="sf-input" autoFocus value={name} disabled={!!busy || !!created.current} onChange={event => setName(event.target.value)} required spellCheck={false} placeholder="my-salesforce-project" />
          </label>
          <div className="sf-login-field"><label htmlFor={folderId}>Parent folder</label>
            <div className="sf-create-folder"><input id={folderId} className="sf-input" value={outputDir} disabled={!!busy || !!created.current} onChange={event => setOutputDir(event.target.value)} required spellCheck={false} placeholder="Choose a folder" />
              <button type="button" className="sf-btn" disabled={!!busy || !!created.current} onClick={() => void run('Choosing folder…', async () => { const picked = await props.pickDirectory(); if (alive.current && picked) setOutputDir(picked); })}>Browse…</button></div>
          </div>
          <p className="sf-create-path">{outputDir && name.trim() ? `${outputDir.replace(/[\\/]+$/, '')}/${name.trim()}` : 'Choose where to save your project.'}</p>
          {created.current && error && <p className="sf-muted">Your folder is ready. Retry to finish connecting it.</p>}
        </>}
        {error && <p className="sf-login-error" role="alert">{error}</p>}
      </div>
      <div className="sf-create-footer">
        <button type="button" className="sf-btn quiet" disabled={!!connected && !!busy} onClick={props.close}>{busy ? 'Close' : 'Cancel'}</button>
        <button type="submit" className="sf-btn primary" disabled={!!busy || (connected ? !name.trim() || !outputDir.trim() : existing && !selected)}>
          {busy || (connected ? created.current ? 'Finish setup' : 'Create project' : existing ? 'Continue' : <><span>Log in to Salesforce</span><ArrowUpRight /></>)}
        </button>
      </div>
    </form>
  </div>;
}
