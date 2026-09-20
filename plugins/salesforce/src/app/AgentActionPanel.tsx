import { useEffect, useMemo, useState } from 'react';
import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import { parseActionTarget, type AgentAction, type ActionParameter } from '../../lib/agent-action-model.js';
import type { ActionSource } from '../../lib/action-source.js';
import type { PublicOrgView } from '../../lib/types.js';
import { ActionCodePreview } from './ActionCodePreview.js';
import { ActionFlowMap } from './ActionFlowMap.js';
import { flowFromXml, flowModel } from './action-flow.js';

export function AgentActionExplorer({ actions, selected, onOpen }: { actions: AgentAction[]; selected?: string; onOpen(action: AgentAction): void }) {
  const groups = [...new Set(actions.map(action => action.owner))];
  return <section className="sf-as-section af-action-explorer" aria-label="Agent actions">
    <div className="sf-as-section-label">Actions <span>{actions.length}</span></div>
    {!actions.length && <p className="sf-as-empty">Actions declared in this script appear here.</p>}
    {groups.map(owner => <details key={owner} open><summary title={owner}>{owner.replace(/^(start_agent|subagent|topic)\./, '')}</summary>{actions.filter(a => a.owner === owner).map(action => {
      const type = parseActionTarget(action.target)?.kind;
      return <button className={`sf-as-tree-btn${selected === action.id ? ' is-active' : ''}`} key={action.id} title={`${action.owner} · ${action.target || 'No target'}`} aria-label={`Inspect ${action.name} in ${action.owner}`} onClick={() => onOpen(action)}><span className={`af-action-icon ${type ?? ''}`} aria-hidden="true">{type === 'apex' ? '{ }' : type === 'flow' ? '⑂' : '↗'}</span><span className="sf-as-tree-name">{action.name}</span><span className="sf-as-tree-meta">{type ?? 'Action'}</span></button>;
    })}</details>)}
  </section>;
}

function Parameters({ title, declared, actual, contractLabel }: { title: string; declared: ActionParameter[]; actual?: ActionParameter[]; contractLabel: string }) {
  const names = [...new Set([...declared.map(p => p.name), ...(actual ?? []).map(p => p.name)])];
  return <section className="af-action-parameters"><h3>{title}</h3>{!names.length ? <p className="af-action-note">{actual ? 'No parameters.' : 'No parameters declared in this action.'}</p> : <table><thead><tr><th>Parameter</th><th>Agent definition</th><th>{contractLabel}</th></tr></thead><tbody>{names.map(name => {
    const script = declared.find(p => p.name === name), target = actual?.find(p => p.name === name);
    return <tr key={name}><th scope="row"><code>{name}</code><small>{script?.description || target?.description}</small></th><td>{script ? <><code>{script.type}</code>{script.required && <small>Required</small>}</> : <span className="af-action-warning">Not declared</span>}</td><td>{actual === undefined ? <span className="af-action-note">Unverified</span> : target ? <><code>{target.type}</code><small>{target.required ? 'Required · ' : ''}{script ? 'Name matched' : 'Not mapped in agent'}</small></> : <span className="af-action-warning">Missing in target</span>}</td></tr>;
  })}</tbody></table>}</section>;
}

export function AgentActionPanel({ pluginId, projectId, action, org, onReveal, onOpenTarget, onOriginChange, initialOrigin = 'project' }: {
  pluginId: string; projectId?: string; action: AgentAction; org: PublicOrgView | null;
  initialOrigin?: 'project' | 'org'; onOriginChange?(origin: 'project' | 'org'): void; onReveal(line: number): void; onOpenTarget(target: string, origin: 'project' | 'org'): void;
}) {
  const [origin, setOrigin] = useState(initialOrigin);
  useEffect(() => setOrigin(initialOrigin), [initialOrigin]);
  const chooseOrigin = (next: 'project' | 'org') => { setOrigin(next); setCandidate(''); onOriginChange?.(next); };
  const [tab, setTab] = useState<'implementation' | 'parameters' | 'usage' | 'preview'>('implementation');
  const [raw, setRaw] = useState(false);
  const [candidate, setCandidate] = useState('');
  useEffect(() => setCandidate(''), [action.target]);
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ key: string; data?: ActionSource; error?: string }>({ key: '' });
  const parsed = parseActionTarget(action.target);
  const key = `${projectId}:${action.target}:${origin}:${org?.orgId}:${org?.alias}:${candidate}:${reload}`;
  const current = state.key === key ? state : undefined;
  const data = current?.data;
  useEffect(() => {
    if (!parseActionTarget(action.target)) return;
    if (origin === 'org' && !org) return;
    let cancelled = false;
    void callPluginRpc(pluginId, 'agentActions.source', { projectId, target: action.target, origin, ...(origin === 'org' ? { orgAlias: org!.alias || org!.username } : {}), ...(candidate && origin === 'project' ? { candidate } : {}) }).then(value => {
      const result = value as { ok: boolean; data?: ActionSource; error?: string };
      if (!cancelled) setState({ key, ...(result.ok && result.data ? { data: result.data } : { error: result.error || 'Could not load this implementation.' }) });
    }).catch(error => { if (!cancelled) setState({ key, error: error instanceof Error ? error.message : String(error) }); });
    return () => { cancelled = true; };
  }, [key, pluginId]);
  const flow = useMemo(() => {
    if (!data || parsed?.kind !== 'flow' || data.status !== 'ready') return undefined;
    try { return { model: flowModel(data.flow ?? flowFromXml(data.content ?? '')) }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  }, [data, parsed?.kind]);
  const actualInputs = data?.inputs ?? flow?.model?.inputs;
  const actualOutputs = data?.outputs ?? flow?.model?.outputs;
  return <section className="af-action-panel" data-testid="agent-action-panel" aria-label={`Action ${action.name}`}>
    <header className="af-action-heading"><div className="af-action-breadcrumb">{action.owner} <span>›</span> {action.name}</div><div className="af-action-title"><span className={`af-action-icon ${parsed?.kind ?? ''}`}>{parsed?.kind === 'apex' ? '{ }' : '⑂'}</span><h2>{parsed?.developerName ?? action.name}</h2><span className="af-action-readonly">Read only</span></div><code className="af-action-target">{action.target || 'No implementation target declared'}</code>{action.description && <p>{action.description}</p>}</header>
    <div className="af-action-sourcebar"><div role="group" aria-label="Implementation source"><button aria-pressed={origin === 'project'} onClick={() => chooseOrigin('project')}>Project</button><button aria-pressed={origin === 'org'} disabled={!org} onClick={() => chooseOrigin('org')}>Org{org ? ` · ${org.alias || org.username}` : ''}</button></div><button aria-label="Refresh implementation" onClick={() => setReload(n => n + 1)}>↻</button></div>
    <div className="af-action-provenance">{data ? <><span>{data.label}{data.version != null ? ` · v${data.version}` : ''}</span><small>{origin === 'project' ? 'Local snapshot · may differ from deployed source' : 'Org snapshot · fetched on demand'}</small></> : <span>{origin === 'project' ? 'Project source' : 'Org implementation'}</span>}</div>
    <nav className="af-action-nav" aria-label="Action details">{([['implementation', 'Implementation'], ['parameters', 'Inputs & outputs'], ['usage', 'Used by'], ['preview', 'Last preview']] as const).map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <div className={`af-action-content${tab === 'implementation' ? ' is-implementation' : ''}`}>
      {tab === 'implementation' && <>
        {!parsed ? <p className="af-action-note">This target type has no implementation viewer yet. Its action definition and usage remain available.</p> : origin === 'org' && !org ? <p className="af-action-note">Connect an org to inspect its deployed implementation.</p> : !current ? <p role="status" className="af-action-note">Loading implementation…</p> : current.error ? <p role="alert" className="af-action-note">{current.error}</p> : <>
          {data?.message && <p className="af-action-note">{data.message}</p>}
          {data?.candidates?.map(path => <button key={path} className="af-source-candidate" onClick={() => setCandidate(path)}>{path} →</button>)}
          {data?.status === 'ready' && <>
            {parsed.kind === 'flow' && <div className="af-flow-mode"><button aria-pressed={!raw} onClick={() => setRaw(false)}>Flow map</button><button aria-pressed={raw} onClick={() => setRaw(true)}>Source</button></div>}
            {parsed.kind === 'flow' && !raw ? flow?.model ? <ActionFlowMap model={flow.model} onOpenTarget={target => onOpenTarget(target, origin)} /> : <p className="af-action-note" role="alert">{flow?.error}</p> : <ActionCodePreview content={data.content ?? ''} language={data.language ?? 'apex'} />}
          </>}
        </>}
      </>}
      {tab === 'parameters' && <><p className="af-action-note">Compare action declarations with {origin === 'project' ? 'this project’s implementation' : 'the selected org’s registered contract'}. Name matches do not verify type compatibility or runtime behavior.</p>{data?.contractMessage && <p className="af-action-note">{data.contractMessage}</p>}{current?.error && <p role="alert" className="af-action-note">{current.error}</p>}<Parameters title="Inputs" declared={action.inputs} actual={actualInputs} contractLabel={origin === 'project' ? 'Project implementation' : 'Org contract'} /><Parameters title="Outputs" declared={action.outputs} actual={actualOutputs} contractLabel={origin === 'project' ? 'Project implementation' : 'Org contract'} /></>}
      {tab === 'usage' && <><p className="af-action-note">Static references in the current editor draft. Availability does not mean the action executed.</p>{!action.id.startsWith('dependency:') && <button className="af-target-link" onClick={() => onReveal(action.line)}>Go to action definition · line {action.line} ↗</button>}{action.uses.length ? action.uses.map((use, i) => <article className="af-action-use" key={i}><button onClick={() => onReveal(use.line)}>{use.kind === 'run' ? 'Explicit run' : 'Available to the model'} <span>Line {use.line} ↗</span></button><pre>{use.code}</pre></article>) : <p className="af-action-note">No direct calls or model bindings found in this scope.</p>}</>}
      {tab === 'preview' && <div className="af-action-empty"><strong>No action trace available</strong><p>The current Preview API integration returns conversation messages and plan IDs. It does not expose verified action inputs, outputs, or execution status here.</p><p>Preview uses simulation; the conversation is not evidence that this Apex or Flow executed.</p></div>}
    </div>
  </section>;
}
