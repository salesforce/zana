import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { callPluginRpc, useRealtime, useZccContext, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import type { AgentDocProposal, AgentDocSnapshot } from '../../lib/agent-doc-contract.js';
import { applyProposalText } from '../../lib/agent-doc-apply.js';
import { lineDiff, type DiffLine } from '../../lib/line-diff.js';
import type { AgentAction } from '../../lib/agent-action-model.js';
import { STUDIO_CHANGED_CHANNEL, STUDIO_RPC, countProblems, type StudioComment } from '../../lib/studio-contract.js';
import type { PublicOrgView } from '../../lib/types.js';
import { orgSessionLabel } from '../../lib/org-session.js';
import { useAgentScriptDoc } from './agent-doc/useAgentScriptDoc.js';
import { ActionCodePreview } from './ActionCodePreview.js';
import { AgentActionExplorer, AgentActionPanel } from './AgentActionPanel.js';
import { AgentScriptGraphPanel } from './AgentScriptGraphPanel.js';
import { AgentforcePreviewPanel } from './AgentforcePreviewPanel.js';
import { CommentsPane } from './studio/CommentsPane.js';
import { runSummary } from './studio/TestsPane.js';
import { useSuites } from './studio/useSuites.js';
import { fetchConnectedOrg } from './org-rpc.js';
import { agentSuitePath } from '../../lib/graph-coverage.js';
import { queueAgentScriptOpen } from './agent-script-open.js';
import { openInStudioWindow, STUDIO_TAB_ID } from './studio-window-route.js';
import { AGENTFORCE_STUDIO_STYLES } from './agentforce-studio-styles.js';

const PLUGIN_ID = 'salesforce';

export const AGENT_THREAD_VIEWS = ['file', 'preview', 'tests', 'graph', 'actions', 'comments'] as const;
export type AgentThreadView = typeof AGENT_THREAD_VIEWS[number];
const VIEW_LABEL: Record<AgentThreadView, string> = { file: 'File', preview: 'Preview', tests: 'Tests', graph: 'Graph', actions: 'Actions', comments: 'Comments' };

export interface AgentThreadParams { path: string; view: AgentThreadView; line?: number; runId?: string; turn?: number; node?: string; projectId?: string }

const text = (value: unknown, max: number): string | undefined => {
  const next = typeof value === 'string' ? value.trim() : '';
  return next && next.length <= max ? next : undefined;
};
const positive = (value: unknown, digits: number): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && new RegExp(`^\\d{1,${digits}}$`).test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};

/** The view picked in a panel survives a host tab switch (which remounts it) until a card retargets the panel. */
const viewStoreKey = (scope: string | undefined, path: string) => `sf-atp-view:${scope ?? ''}:${path}`;
export function recallAgentThreadView(scope: string | undefined, path: string, card: string): AgentThreadView | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(viewStoreKey(scope, path)) ?? 'null') as { view?: unknown; card?: unknown } | null;
    return saved?.card === card ? AGENT_THREAD_VIEWS.find(row => row === saved.view) ?? null : null;
  } catch { return null; }
}
export function rememberAgentThreadView(scope: string | undefined, path: string, card: string, view: AgentThreadView): void {
  try { sessionStorage.setItem(viewStoreKey(scope, path), JSON.stringify({ view, card })); } catch { /* storage unavailable: the view resets on remount */ }
}

/** Validated parse of the `agent` thread-panel params (all strings from the chat renderer); null without a usable `.agent` path. */
export function parseAgentThreadParams(params: unknown): AgentThreadParams | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const raw = params as Record<string, unknown>;
  const path = text(raw.path, 500);
  if (!path || !/\.(agent|afscript)$/i.test(path) || path.split(/[\\/]/).includes('..')) return null;
  const view = AGENT_THREAD_VIEWS.find(row => row === raw.view) ?? 'file';
  const next: AgentThreadParams = { path, view };
  const line = positive(raw.line, 7);
  if (line) next.line = line;
  const runId = text(raw.runId, 256);
  if (runId) next.runId = runId;
  const turn = positive(raw.turn, 4);
  if (turn) next.turn = turn;
  const node = text(raw.node, 200);
  if (node) next.node = node;
  const projectId = text(raw.projectId, 200);
  if (projectId) next.projectId = projectId;
  return next;
}

/** A diff reduced to its changed lines with two lines of context; `…` rows mark skipped runs. */
export function diffRows(diff: DiffLine[], context = 2): Array<DiffLine | null> {
  const keep = diff.map(() => false);
  diff.forEach((row, i) => {
    if (row.type === 'same') return;
    for (let j = Math.max(0, i - context); j <= Math.min(diff.length - 1, i + context); j += 1) keep[j] = true;
  });
  const rows: Array<DiffLine | null> = [];
  diff.forEach((row, i) => { if (keep[i]) rows.push(row); else if (rows[rows.length - 1] !== null) rows.push(null); });
  return rows;
}

const STYLES = `
.sf-atp { height:100%; min-height:0; display:flex; flex-direction:column; font-size:12px; color:var(--sf-text); background:var(--sf-surface); }
.sf-atp-head { display:flex; align-items:center; gap:8px; padding:8px 10px; border-bottom:1px solid var(--sf-border); flex-wrap:wrap; }
.sf-atp-title { min-width:0; flex:1; }
.sf-atp-name { font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-atp-path { color:var(--sf-muted); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.sf-atp-pill { border:1px solid var(--sf-border); border-radius:999px; padding:1px 8px; font-size:11px; color:var(--sf-muted); white-space:nowrap; }
.sf-atp-pill.is-warn { color:var(--sf-warn); border-color:var(--sf-warn); }
.sf-atp-btn { border:1px solid var(--sf-border); background:transparent; color:var(--sf-text); border-radius:6px; padding:3px 10px; font:inherit; cursor:pointer; }
.sf-atp-btn.is-primary { border-color:var(--sf-accent); color:var(--sf-accent); }
.sf-atp-btn.is-danger { border-color:var(--sf-danger); color:var(--sf-danger); }
.sf-atp-btn:disabled { opacity:.5; cursor:default; }
.sf-atp-tabs { display:flex; gap:2px; padding:0 6px; border-bottom:1px solid var(--sf-border); overflow:auto; }
.sf-atp-tab { border:0; border-bottom:2px solid transparent; background:transparent; color:var(--sf-muted); padding:6px 9px; font:inherit; cursor:pointer; }
.sf-atp-tab[aria-selected="true"] { color:var(--sf-accent); border-bottom-color:var(--sf-accent); }
.sf-atp-body { flex:1; min-height:0; position:relative; display:flex; flex-direction:column; }
.sf-atp-view { flex:1; min-height:0; display:flex; flex-direction:column; overflow:auto; }
.sf-atp-view[hidden] { display:none; }
.sf-atp-banner { padding:5px 10px; background:var(--sf-soft); border-bottom:1px solid var(--sf-border); display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.sf-atp-code { flex:1; min-height:240px; width:100%; border:0; }
.sf-atp-section { padding:8px 10px; border-top:1px solid var(--sf-border); display:flex; flex-direction:column; gap:6px; }
.sf-atp-section h3 { margin:0; font-size:11px; text-transform:uppercase; letter-spacing:.04em; color:var(--sf-muted); }
.sf-atp-empty { color:var(--sf-muted); padding:16px 12px; }
.sf-atp-error { color:var(--sf-danger); }
.sf-atp-diff { margin:0; font-family:ui-monospace,monospace; font-size:11px; overflow:auto; max-height:220px; border:1px solid var(--sf-border); border-radius:6px; }
.sf-atp-diff div { padding:0 6px; white-space:pre; }
.sf-atp-diff .add { background:color-mix(in srgb, var(--sf-success) 18%, transparent); }
.sf-atp-diff .del { background:color-mix(in srgb, var(--sf-danger) 18%, transparent); }
.sf-atp-diff .gap { color:var(--sf-muted); }
.sf-atp-row { display:flex; gap:6px; align-items:center; }
.sf-atp-row > .grow { flex:1; min-width:0; }
.sf-atp-link { background:none; border:0; padding:0; color:var(--sf-accent); font:inherit; cursor:pointer; text-align:left; }
.sf-atp-card { border:1px solid var(--sf-border); border-radius:8px; padding:8px; display:flex; flex-direction:column; gap:6px; }
`;

function DiffList({ rows, label }: { rows: Array<DiffLine | null>; label: string }) {
  return <pre className="sf-atp-diff" aria-label={label}>
    {rows.map((row, i) => row
      ? <div key={i} className={row.type === 'same' ? '' : row.type}>{row.type === 'add' ? '+ ' : row.type === 'del' ? '- ' : '  '}{row.text}</div>
      : <div key={i} className="gap">…</div>)}
  </pre>;
}

type Resolve = (id: string, decision: 'accept' | 'reject') => Promise<{ ok: boolean; error?: string; code?: string }>;

function ProposalCard({ proposal, base, baseSha, onResolve }: { proposal: AgentDocProposal; base: string | null; baseSha: string; onResolve: Resolve }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => {
    // A resolved proposal may arrive without its body (the server strips it): nothing to diff then.
    if (base === null || !proposal.input || (proposal.input.content === undefined && !proposal.input.edits)) return null;
    try {
      const diff = lineDiff(base, applyProposalText(base, proposal.input));
      return diff ? diffRows(diff) : null;
    } catch { return null; }
  }, [base, proposal.input]);
  const waiting = proposal.status === 'accept-requested';
  // It was written against another version of the file: Studio would refuse it, so only Reject stays.
  const stale = Boolean(proposal.input?.expectedSha256) && proposal.input.expectedSha256 !== baseSha;
  const decide = async (decision: 'accept' | 'reject') => {
    setBusy(true); setError(null);
    try {
      const result = await onResolve(proposal.id, decision);
      if (!result.ok) setError(result.code === 'conflict' ? `The file changed since this edit was proposed. ${result.error || ''}`.trim() : result.error || `Could not ${decision} the proposal.`);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };
  return <div className="sf-atp-card" data-testid="atp-proposal">
    <div>{proposal.input?.summary || 'Proposed edit'}</div>
    {stale && !waiting && <div className="sf-atp-pill is-warn" role="status" data-testid="atp-stale">Stale: the file changed after this edit was proposed</div>}
    {rows ? <DiffList rows={rows} label="Proposal diff" /> : <div className="sf-atp-path">No diff preview available.</div>}
    {error && <div className="sf-atp-error" role="alert">{error}</div>}
    {waiting && <div className="sf-atp-pill is-warn" role="status">Waiting for Studio to apply</div>}
    {/* Reject stays while Studio applies: the server refuses it while Studio holds the file, and allows it once Studio is gone. */}
    <div className="sf-atp-row">
      {!waiting && <button type="button" className="sf-atp-btn is-primary" disabled={busy || stale} onClick={() => void decide('accept')}>Accept</button>}
      <button type="button" className="sf-atp-btn is-danger" disabled={busy} onClick={() => void decide('reject')}>Reject</button>
    </div>
  </div>;
}

interface FileViewProps {
  doc: AgentDocSnapshot | null; loading: boolean; error: string | null; leasedBy: string | null; line?: number;
  resolve: Resolve;
}

function FileView({ doc, loading, error, leasedBy, line, resolve }: FileViewProps) {
  const [diff, setDiff] = useState(false);
  const [reveal, setReveal] = useState<number | undefined>(line);
  useEffect(() => setReveal(line), [line]);
  if (!doc) return <div className="sf-atp-empty">{error ? <span className="sf-atp-error" role="alert">{error}</span> : loading ? 'Loading agent…' : 'Agent not available.'}</div>;
  const dirty = doc.dirty;
  const showDiff = diff && dirty && doc.savedText !== null && doc.text !== null;
  const diffView = showDiff ? lineDiff(doc.savedText!, doc.text!) : null;
  const pending = doc.proposals.filter(row => row.status === 'pending' || row.status === 'accept-requested');
  const problems = doc.diagnostics;
  return <>
    {(dirty || leasedBy) && <div className="sf-atp-banner">
      {dirty && <span className="sf-atp-pill is-warn">Unsaved in Studio</span>}
      {leasedBy && <span className="sf-atp-pill">Editing in Studio{leasedBy !== 'Studio' ? ` · ${leasedBy}` : ''}</span>}
      {dirty && doc.savedText !== null && <button type="button" className="sf-atp-btn" aria-pressed={diff} onClick={() => setDiff(value => !value)}>{diff ? 'Hide diff' : 'Diff vs disk'}</button>}
    </div>}
    {doc.text === null
      ? <div className="sf-atp-empty">This file is too large to show here. Open it in Studio.</div>
      : showDiff
        ? (diffView ? <DiffList rows={diffRows(diffView)} label="Diff vs disk" /> : <div className="sf-atp-empty">The diff is too large to show.</div>)
        : <ActionCodePreview className="sf-atp-code" title="Agent script (read-only)" content={doc.text} language="agentscript" line={reveal} />}
    {pending.length > 0 && <section className="sf-atp-section" aria-label="Proposals">
      <h3>Proposals ({pending.length})</h3>
      {pending.map(row => <ProposalCard key={row.id} proposal={row} base={doc.text} baseSha={doc.baseSha256} onResolve={resolve} />)}
    </section>}
    {problems.length > 0 && <section className="sf-atp-section" aria-label="Problems">
      <h3>Problems ({countProblems(problems)})</h3>
      {problems.map((item, i) => <button key={i} type="button" className="sf-atp-link" onClick={() => { setDiff(false); setReveal(item.line); }}>
        {item.severity} · line {item.line} · {item.message}
      </button>)}
    </section>}
  </>;
}

function TestsView({ pluginId, projectId, path, onOpenStudio }: { pluginId: string; projectId?: string; path: string; onOpenStudio(): void }) {
  const suitePath = agentSuitePath(path);
  const suites = useSuites(pluginId, projectId).filter(suite => suitePath !== null && suite.path === suitePath);
  return <div className="sf-atp-section" data-testid="atp-tests">
    {!suites.length && <div className="sf-atp-empty">No saved test suites for this agent.</div>}
    {suites.map(suite => {
      const sum = runSummary(suite.cases, suite.lastResults);
      return <div key={suite.id} className="sf-atp-card">
        <div className="sf-atp-row"><span className="grow">{suite.cases.length} case{suite.cases.length === 1 ? '' : 's'}</span>
          {sum.ran ? <span className={`sf-atp-pill${sum.fail ? ' is-warn' : ''}`}>{sum.pass}/{sum.ran} passed</span> : <span className="sf-atp-pill">not run</span>}</div>
      </div>;
    })}
    <div><button type="button" className="sf-atp-btn" onClick={onOpenStudio}>Open Tests in Studio</button></div>
  </div>;
}

function ActionsView({ pluginId, projectId, source, org, onReveal }: { pluginId: string; projectId?: string; source: string | null; org: PublicOrgView | null; onReveal(line: number): void }) {
  const [actions, setActions] = useState<AgentAction[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (source === null) { setActions([]); return; }
    let live = true;
    void Promise.resolve(callPluginRpc(pluginId, 'agentScript.parse', { source })).then(reply => {
      const out = reply as { ok?: boolean; error?: string; result?: { actions?: AgentAction[] } } | null;
      if (!live) return;
      if (out?.ok === false) { setFailed(out.error || 'Could not read the actions.'); setActions([]); return; }
      setFailed(null); setActions(Array.isArray(out?.result?.actions) ? out!.result!.actions! : []);
    }).catch(err => { if (live) { setFailed(err instanceof Error ? err.message : String(err)); setActions([]); } });
    return () => { live = false; };
  }, [pluginId, source]);
  const action = actions.find(row => row.id === selected) ?? null;
  return <div className="sf-as" data-testid="atp-actions">
    {failed && <div className="sf-atp-section sf-atp-error" role="alert">{failed}</div>}
    <AgentActionExplorer actions={actions} selected={action?.id} onOpen={row => setSelected(row.id)} />
    {action && <AgentActionPanel key={action.id} pluginId={pluginId} projectId={projectId} org={org} action={action} onReveal={onReveal} onOpenTarget={() => undefined} />}
  </div>;
}

function CommentsView({ pluginId, projectId, path, source, onReveal }: { pluginId: string; projectId?: string; path: string; source: string | null; onReveal(line: number): void }) {
  const [comments, setComments] = useState<StudioComment[]>([]);
  const load = useCallback(async () => {
    if (!projectId) { setComments([]); return; }
    try {
      const reply = await callPluginRpc(pluginId, STUDIO_RPC.comments, { projectId, path, includeResolved: true, content: source || undefined }) as { ok?: boolean; comments?: StudioComment[] } | null;
      if (reply?.ok !== false && Array.isArray(reply?.comments)) setComments(reply.comments);
    } catch { /* comments are optional */ }
  }, [pluginId, projectId, path, source]);
  useEffect(() => { void load(); }, [load]);
  useRealtime(STUDIO_CHANGED_CHANNEL, payload => {
    const row = payload as { kind?: string; projectId?: string } | null;
    if (row?.kind === 'comments' && (!row.projectId || row.projectId === projectId)) void load();
  });
  return <CommentsPane pluginId={pluginId} projectId={projectId} path={path} comments={comments} onReveal={onReveal} />;
}

interface AgentThreadPanelProps { pluginId: string; threadId?: string; tabId?: string; projectId?: string; orgAlias?: string; params?: unknown }

/** The thread side panel for one agent: read-only File, Preview, Tests, Graph, Actions and Comments over the shared document. */
export function AgentThreadPanel(props: AgentThreadPanelProps) {
  const parsed = parseAgentThreadParams(props.params);
  if (!parsed) {
    return <div className="sf-atp sf-as" data-testid="atp-empty"><style>{STYLES}</style>
      <div className="sf-atp-empty" role="alert">This panel needs an Agent Script path (a .agent file). Open an agent from a chat card.</div></div>;
  }
  return <AgentThreadWorkspace key={parsed.path} {...props} parsed={parsed} />;
}

function AgentThreadWorkspace(props: AgentThreadPanelProps & { parsed: AgentThreadParams }) {
  const { parsed } = props;
  const pluginId = props.pluginId || PLUGIN_ID;
  const ctx = useZccContext();
  const navigate = useZccNavigate();
  const projectId = props.projectId ?? parsed.projectId ?? ctx.projectId ?? undefined;
  const { path } = parsed;
  // Another card can retarget an open panel (same agent, other view/line/run); follow it.
  const key = JSON.stringify([parsed.view, parsed.line, parsed.node, parsed.runId, parsed.turn]);
  const scope = props.tabId ?? props.threadId;
  const [view, setView] = useState<AgentThreadView>(() => recallAgentThreadView(scope, path, key) ?? parsed.view);
  const [visited, setVisited] = useState<ReadonlySet<AgentThreadView>>(() => new Set([view]));
  useEffect(() => { rememberAgentThreadView(scope, path, key, view); }, [scope, path, key, view]);
  const followedKey = useRef(key);
  const [jump, setJump] = useState<{ line?: number; node?: string; seq: number }>({ line: parsed.line, node: parsed.node, seq: 1 });
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const api = useAgentScriptDoc(pluginId, projectId ?? null, path);
  const { doc } = api;

  const show = useCallback((next: AgentThreadView) => { setView(next); setVisited(prev => prev.has(next) ? prev : new Set([...prev, next])); }, []);
  useEffect(() => {
    if (followedKey.current === key) return;
    followedKey.current = key;
    show(parsed.view);
    setJump(prev => ({ line: parsed.line, node: parsed.node, seq: prev.seq + 1 }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    void fetchConnectedOrg(pluginId, projectId, props.orgAlias).then(result => { if (live) setOrg(result.ok ? result.org : null); }).catch(() => { if (live) setOrg(null); });
    return () => { live = false; };
  }, [pluginId, projectId, props.orgAlias]);

  const name = path.split(/[\\/]/).pop()!;
  const revealLine = useCallback((line: number) => { setJump(prev => ({ ...prev, line, seq: prev.seq + 1 })); show('file'); }, [show]);
  const openStudio = async () => {
    if (!projectId) return;
    if (await openInStudioWindow({ pluginId, projectId, path, ...(jump.line ? { line: jump.line } : {}), navigate })) return;
    queueAgentScriptOpen(projectId, path);
    navigate.toProject(projectId, { tabId: STUDIO_TAB_ID });
  };
  // Accept names the version it was reviewed against, so Studio refuses it when the file moved on.
  const baseSha = doc?.baseSha256;
  const resolve = useCallback<Resolve>((id, decision) => api.resolve(id, decision, decision === 'accept' ? baseSha : undefined), [api, baseSha]);
  const onKeyDown = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    show(AGENT_THREAD_VIEWS[(AGENT_THREAD_VIEWS.indexOf(view) + step + AGENT_THREAD_VIEWS.length) % AGENT_THREAD_VIEWS.length]!);
  };
  const lazy = (id: AgentThreadView, node: () => ReactNode) => visited.has(id)
    ? <div className="sf-atp-view" role="tabpanel" id={`atp-panel-${id}`} aria-labelledby={`atp-tab-${id}`} hidden={view !== id} data-testid={`atp-view-${id}`}>{node()}</div>
    : null;
  const orgLabel = orgSessionLabel(org);

  return <div className="sf-atp sf-as" data-testid="atp-root">
    <style>{AGENTFORCE_STUDIO_STYLES}</style><style>{STYLES}</style>
    <div className="sf-atp-head">
      <div className="sf-atp-title"><div className="sf-atp-name">{name.replace(/\.(agent|afscript)$/i, '')}</div><div className="sf-atp-path" title={path}>{path}</div></div>
      {orgLabel && <span className="sf-atp-pill" data-testid="atp-org">{orgLabel}</span>}
      <button type="button" className="sf-atp-btn is-primary" disabled={!projectId} onClick={() => void openStudio()}>Open in Studio ↗</button>
    </div>
    <div className="sf-atp-tabs" role="tablist" aria-label="Agent views" onKeyDown={onKeyDown}>
      {AGENT_THREAD_VIEWS.map(id => <button key={id} type="button" role="tab" id={`atp-tab-${id}`} className="sf-atp-tab" aria-selected={view === id} aria-controls={`atp-panel-${id}`} tabIndex={view === id ? 0 : -1} onClick={() => show(id)}>{VIEW_LABEL[id]}</button>)}
    </div>
    <div className="sf-atp-body">
      {lazy('file', () => <FileView doc={doc} loading={api.loading} error={api.error} leasedBy={doc?.lease ? doc.lease.label || 'Studio' : null} line={jump.line} resolve={resolve} />)}
      {lazy('preview', () => <AgentforcePreviewPanel pluginId={pluginId} threadId={props.threadId} tabId={props.tabId} projectId={projectId} orgAlias={props.orgAlias} pinnedPath={path}
        params={{ path, ...(parsed.runId ? { runId: parsed.runId } : {}), ...(parsed.turn ? { turn: String(parsed.turn) } : {}) }} />)}
      {lazy('tests', () => <TestsView pluginId={pluginId} projectId={projectId} path={path} onOpenStudio={() => void openStudio()} />)}
      {lazy('graph', () => doc?.text != null
        ? <AgentScriptGraphPanel source={doc.text} visible={view === 'graph'} compact focusNode={jump.node ?? null} focusSeq={jump.seq} onOpenAction={() => show('actions')} />
        : <div className="sf-atp-empty">{api.loading ? 'Loading agent…' : 'The graph needs the agent text.'}</div>)}
      {lazy('actions', () => <ActionsView pluginId={pluginId} projectId={projectId} source={doc?.text ?? null} org={org} onReveal={revealLine} />)}
      {lazy('comments', () => <CommentsView pluginId={pluginId} projectId={projectId} path={path} source={doc?.text ?? null} onReveal={revealLine} />)}
    </div>
  </div>;
}
