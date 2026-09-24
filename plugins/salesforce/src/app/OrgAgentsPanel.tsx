import { useEffect, useRef, useState } from 'react';
import { Bot, Download, Plus, RefreshCw, Search } from 'lucide-react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { OrgAgentCatalog, OrgAgentRetrieval, RetrievedOrgAgent } from '../../lib/org-agent-contract.js';
import { EmptyState, LoadingState, SalesforceState } from './components/SalesforceState.js';

export function OrgAgentsPanel({ pluginId, projectId, visible, editorReady, onOpen, onNew, localFiles = [], onLocalOpen, onPublish }: {
  pluginId: string; projectId?: string; visible: boolean; editorReady: boolean;
  onNew?(): void;
  localFiles?: Array<{ path: string; apiName: string }>;
  onLocalOpen?(path: string): void;
  onPublish?(path: string): void;
  onOpen(file: RetrievedOrgAgent, isCurrent: () => boolean): Promise<void>;
}) {
  const [catalog, setCatalog] = useState<OrgAgentCatalog | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retrieving, setRetrieving] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const epoch = useRef(0);
  const job = useRef<{ id: string; projectId?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const active = useRef(false);

  useEffect(() => {
    const reset = () => {
      epoch.current++;
      if (timer.current) clearTimeout(timer.current);
      wake.current?.(); wake.current = null;
      const pending = job.current; job.current = null; active.current = false;
      if (pending) void callPluginRpc(pluginId, 'agents.retrieve.cancel', { projectId: pending.projectId, jobId: pending.id }).catch(() => {});
    };
    const changed = (event: Event) => {
      const id = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (id && id !== projectId) return;
      reset(); setCatalog(null); setSelected({}); setError(null); setNotice(null); setRetrieving(null); setLoaded(false); setRevision(value => value + 1);
    };
    setCatalog(null); setLoaded(false);
    window.addEventListener('sf:context-changed', changed);
    return () => { reset(); window.removeEventListener('sf:context-changed', changed); };
  }, [pluginId, projectId]);

  useEffect(() => {
    if (!visible || loaded) return;
    let cancelled = false;
    const current = epoch.current;
    setLoading(true); setError(null);
    void callPluginRpc(pluginId, 'agents.list', { projectId }).then(payload => {
      if (cancelled || current !== epoch.current) return;
      const result = payload as { ok: boolean; data?: OrgAgentCatalog; error?: string };
      if (!result.ok || !result.data) throw Error(result.error || 'Could not load agents.');
      setCatalog(result.data);
      setSelected({});
    }).catch(failure => {
      if (!cancelled && current === epoch.current) setError(failure instanceof Error ? failure.message : 'Could not load agents.');
    }).finally(() => {
      if (!cancelled && current === epoch.current) { setLoading(false); setLoaded(true); }
    });
    return () => { cancelled = true; };
  }, [pluginId, projectId, visible, loaded, revision]);

  async function retrieve(fullName: string) {
    if (!catalog || active.current) return;
    active.current = true;
    const current = epoch.current;
    setRetrieving(fullName); setError(null); setNotice(null);
    try {
      const started = await callPluginRpc(pluginId, 'agents.retrieve.start', { projectId, orgId: catalog.org.orgId, fullName }) as { ok: boolean; jobId?: string; error?: string };
      if (!started.ok || !started.jobId) throw Error(started.error || 'Could not start retrieval.');
      if (current !== epoch.current) {
        void callPluginRpc(pluginId, 'agents.retrieve.cancel', { projectId, jobId: started.jobId }).catch(() => {});
        return;
      }
      job.current = { id: started.jobId, projectId };
      for (let attempt = 0; attempt < 160; attempt++) {
        const result = await callPluginRpc(pluginId, 'agents.retrieve.status', { projectId, jobId: started.jobId }) as { ok: boolean; data?: OrgAgentRetrieval; error?: string };
        if (current !== epoch.current) return;
        if (!result.ok || !result.data) throw Error(result.error || 'Could not check retrieval.');
        if (result.data.state === 'failed') throw Error(result.data.error);
        if (result.data.state === 'done') {
          if (result.data.file.orgId !== catalog.org.orgId) throw Error('The org changed. Refresh and select your agent again.');
          job.current = null;
          await onOpen(result.data.file, () => current === epoch.current);
          if (current === epoch.current) setNotice(result.data.file.existing ? 'Opened your local copy. Existing edits were preserved.' : 'Retrieved to your project. Changes are saved locally.');
          return;
        }
        await new Promise<void>(resolve => { wake.current = resolve; timer.current = setTimeout(resolve, 1000); });
        if (current !== epoch.current) return;
      }
      throw Error('Retrieval timed out. Try again.');
    } catch (failure) {
      if (current === epoch.current) setError(failure instanceof Error ? failure.message : 'Could not retrieve this agent.');
    } finally {
      if (current === epoch.current) {
        const pending = job.current; job.current = null;
        if (pending) void callPluginRpc(pluginId, 'agents.retrieve.cancel', { projectId, jobId: pending.id }).catch(() => {});
        active.current = false; setRetrieving(null);
      }
    }
  }

  const agents = catalog?.agents.filter(agent => `${agent.name} ${agent.versions.map(version => version.fullName).join(' ')}`.toLowerCase().includes(query.toLowerCase())) ?? [];
  return <section className="af-org-agents" aria-label="Org agents">
    <header><div><strong>Agents</strong><small>{catalog?.org.alias || 'Connected org'}</small></div>{onNew && <button type="button" className="af-secondary" disabled={!editorReady} onClick={onNew}><Plus size={13} aria-hidden="true" />New agent</button>}<button className="icon-btn" type="button" title="Refresh agents" aria-label="Refresh agents" disabled={loading || Boolean(retrieving)} onClick={() => { setLoaded(false); setRevision(value => value + 1); }}><RefreshCw size={14} aria-hidden="true" /></button></header>
    <label className="af-agent-search"><Search size={14} aria-hidden="true" /><input aria-label="Search org agents" placeholder="Search agents…" value={query} onChange={event => setQuery(event.target.value)} /></label>
    {localFiles.length > 0 && <section aria-label="Local agents"><p className="af-agent-caption">Local agents</p>{localFiles.filter(file => `${file.apiName} ${file.path}`.toLowerCase().includes(query.toLowerCase())).map(file => <article className="af-agent-card" key={file.path}>
      <div className="af-agent-name"><Bot size={17} aria-hidden="true" /><strong>{file.apiName.replace(/_/g, ' ')}</strong></div>
      <small className="af-agent-api-name" title={file.path}>{file.path}</small>
      <div className="af-agent-card-actions"><button type="button" className="af-secondary" disabled={!editorReady} onClick={() => onLocalOpen?.(file.path)}>Open draft</button>{onPublish && <button type="button" className="af-secondary" onClick={() => onPublish(file.path)}>Review publish…</button>}</div>
    </article>)}</section>}
    <p className="af-agent-caption">Choose an Agent Script source version to edit.</p>
    {loading && <LoadingState compact art="agents" label="Loading agents…" hint="Finding Agent Script sources in your org." />}
    {error && (catalog?.agents.length ? <div className="af-error" role="alert">{error}</div> : <SalesforceState compact kind="error" art="agents" title="Org agents unavailable"
      action={onNew && <button type="button" className="af-secondary" disabled={!editorReady} onClick={onNew}>Create a local agent</button>}>{error}</SalesforceState>)}
    {notice && <div className="af-notice" role="status">{notice}</div>}
    {!loading && !error && loaded && agents.length === 0 && <EmptyState compact art={query ? 'search' : 'agents'} title={query ? 'No matching agents' : 'No Agent Script sources found'}
      action={!query && onNew && <button type="button" className="af-secondary" disabled={!editorReady} onClick={onNew}>Create a local agent</button>}>
      {query ? 'Try another name.' : 'Start with a local draft, or choose an org with Agent Script sources. Agents from the legacy builder do not include editable source.'}
    </EmptyState>}
    <div className="af-agent-list">{agents.map(agent => {
      const fullName = selected[agent.name] || agent.versions[0].fullName;
      return <article key={agent.name} className="af-agent-card">
        <div className="af-agent-name"><Bot size={17} aria-hidden="true" /><strong title={agent.name}>{agent.name.replace(/_/g, ' ')}</strong></div>
        <small className="af-agent-api-name">{agent.name}</small>
        <div className="af-agent-card-actions"><select aria-label={`Source version for ${agent.name}`} value={fullName} disabled={Boolean(retrieving)} onChange={event => setSelected(value => ({ ...value, [agent.name]: event.target.value }))}>{agent.versions.map(version => <option key={version.fullName} value={version.fullName}>{version.version === null ? 'Current source' : `Source v${version.version}`}</option>)}</select><button className="af-secondary" type="button" disabled={Boolean(retrieving) || !editorReady} onClick={() => void retrieve(fullName)}><Download size={13} aria-hidden="true" />{retrieving === fullName ? 'Retrieving…' : 'Retrieve & open'}</button></div>
      </article>;
    })}</div>
    {catalog?.truncated && <p className="af-agent-caption">Showing the first 1,000 source versions returned by Salesforce.</p>}
  </section>;
}
