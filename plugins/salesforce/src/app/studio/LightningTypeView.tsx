import { useEffect, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { cachedRead, readCacheKey, rememberRead } from './read-cache.js';
import { UsedByAgents } from './UsedByAgents.js';
import { STUDIO_RPC, type LightningTypeView as LightningTypeData } from '../../../lib/studio-contract.js';
import { EmptyState } from '../components/SalesforceState.js';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: LightningTypeData };

/**
 * Read-only Lightning Type tab: the schema's properties, the agents whose actions declare the type, the LWCs its renderer
 * and editor override with, and the bundle's raw JSON (schema.json plus each channel's renderer/editor). Standard and missing types explain themselves.
 */
export function LightningTypeView({ pluginId, projectId, typeRef, usedBy, onOpenAgent, onOpenComponent }: {
  pluginId: string;
  projectId?: string;
  typeRef: string;
  usedBy?: string[];
  onOpenAgent(path: string): void;
  onOpenComponent?(ref: string): void;
}) {
  const key = readCacheKey(pluginId, projectId, 'lightning-type', typeRef);
  const initial = (): Load => { const data = cachedRead<LightningTypeData>(key); return data ? { state: 'ready', data } : { state: 'loading' }; };
  const [load, setLoad] = useState<Load>(initial);
  const [file, setFile] = useState(0);
  useEffect(() => {
    let alive = true;
    // A remount keeps the last answer on screen while it reads again; a new ref starts over.
    setLoad(initial());
    Promise.resolve(callPluginRpc(pluginId, STUDIO_RPC.lightningType, { ...(projectId ? { projectId } : {}), ref: typeRef }))
      .then(result => {
        const res = result as { ok?: boolean; data?: LightningTypeData; error?: string } | null;
        if (!alive) return;
        if (res?.ok && res.data) { rememberRead(key, res.data); setLoad({ state: 'ready', data: res.data }); }
        else setLoad({ state: 'error', message: res?.error || 'The Lightning Type could not be read.' });
      })
      .catch(err => { if (alive) setLoad({ state: 'error', message: err instanceof Error ? err.message : String(err) }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` names exactly these inputs.
  }, [key]);

  const data = load.state === 'ready' ? load.data : null;
  const shown = data?.files[file];
  return <section className="sf-lt" data-testid="lightning-type-view" aria-label={`Lightning Type ${typeRef}`}>
    <header className="sf-lt-head">
      <div>
        <h2>{data?.title || typeRef}</h2>
        <div className="sf-lt-meta">
          <code>{typeRef}</code>
          <span className="sf-lt-badge">{data ? data.standard ? 'Standard' : data.status === 'missing' ? 'Not in project' : 'Custom' : 'Lightning Type'}</span>
          {data?.path && <span className="sf-lt-path" title={data.path}>{data.path}</span>}
        </div>
        {data?.description && <p>{data.description}</p>}
      </div>
    </header>
    {load.state === 'loading' && <p className="sf-lt-note">Loading…</p>}
    {load.state === 'error' && <p className="sf-lt-note is-error" role="alert">{load.message}</p>}
    {data?.message && <p className={`sf-lt-note${data.status === 'ready' ? ' is-warn' : ''}`}>{data.message}</p>}
    {usedBy && usedBy.length > 0 && <dl className="sf-lt-rel"><UsedByAgents usedBy={usedBy} onOpenAgent={onOpenAgent} /></dl>}
    {data?.status === 'ready' && <div className="sf-lt-section">
      <h3>Properties</h3>
      {data.properties.length === 0
        ? <EmptyState compact art="code" title="No properties">The schema declares no top-level properties.</EmptyState>
        : <table className="sf-lt-table">
          <thead><tr><th scope="col">Name</th><th scope="col">Type</th><th scope="col">Description</th></tr></thead>
          <tbody>{data.properties.map(row => <tr key={row.name}>
            <td><code>{row.name}</code>{row.required && <span className="sf-lt-req" title="Required">*</span>}{row.title && <div className="sf-lt-sub">{row.title}</div>}</td>
            <td><code>{row.type ?? '—'}</code></td>
            <td>{row.description ?? ''}</td>
          </tr>)}</tbody>
        </table>}
    </div>}
    {data && (data.components?.length ?? 0) > 0 && <div className="sf-lt-section">
      <h3>Components</h3>
      <table className="sf-lt-table" aria-label="Components">
        <thead><tr><th scope="col">Component</th><th scope="col">Role</th><th scope="col">Channel</th><th scope="col">Overrides</th></tr></thead>
        <tbody>{data.components.map(row => <tr key={`${row.channel}:${row.role}:${row.target}:${row.ref}`}>
          <td>{onOpenComponent
            ? <button type="button" className="af-text-button" title={row.path ?? row.ref} onClick={() => onOpenComponent(row.ref)}>{row.ref}</button>
            : <code>{row.ref}</code>}
            {!row.path && <span className="sf-lt-sub">Not in this project</span>}</td>
          <td>{row.role === 'editor' ? 'Editor' : 'Renderer'}</td>
          <td><code>{row.channel || '—'}</code></td>
          <td>{row.target === '$' ? 'Whole type' : <code>{row.target}</code>}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {data && data.files.length > 0 && <div className="sf-lt-section">
      <h3>Bundle files</h3>
      <div className="sf-lt-files" role="group" aria-label="Bundle files">
        {data.files.map((row, index) => <button key={row.path} type="button" aria-pressed={index === file} title={row.path} onClick={() => setFile(index)}>{row.path.split('/').slice(-2).join('/')}</button>)}
      </div>
      {shown && <pre className="sf-lt-source" aria-label={`Source of ${shown.path}`}>{shown.truncated ? 'This file is larger than 256 KB. Open it in your editor to read it.' : shown.content}</pre>}
    </div>}
  </section>;
}
