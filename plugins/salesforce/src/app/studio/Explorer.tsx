import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, Bot, Braces, ChevronRight, Cloud, Component, FlaskConical, History, Library, MessageSquareText, PanelLeftClose, Shapes, Workflow } from 'lucide-react';
import type { ExplorerNode, ExplorerUse } from '../../../lib/studio-contract.js';
import { EmptyState } from '../components/SalesforceState.js';
import type { PlaygroundFileRef } from '../playground-bridge.js';
import { modShortcut } from '../shortcut-label.js';
import { agentSummary } from './bundle-format.js';

type Icon = ComponentType<{ size?: number; className?: string; 'aria-hidden'?: boolean | 'true' }>;
type RefKind = ExplorerUse['kind'];

const KIND_LABEL: Record<string, string> = { apex: 'Apex', flow: 'Flow', prompt: 'Prompts', 'lightning-type': 'Lightning Types', lwc: 'Components', scenario: 'Tests', 'org-agent': 'Org agents' };
const SECTION_ORDER = ['apex', 'flow', 'prompt', 'lightning-type', 'lwc', 'scenario', 'org-agent'] as const;
const REF_KINDS: readonly RefKind[] = ['apex', 'flow', 'prompt', 'lightning-type', 'lwc'];
const REF_GROUP_LABEL: Record<RefKind, string> = { apex: 'Apex', flow: 'Flows', prompt: 'Prompts', 'lightning-type': 'Types', lwc: 'Components' };
const KIND_ICON: Record<string, Icon> = { agent: Bot, apex: Braces, flow: Workflow, prompt: MessageSquareText, 'lightning-type': Shapes, lwc: Component, scenario: FlaskConical, 'org-agent': Cloud };
/** Sections that start folded; toggling one records it in `collapsed`, which flips its default. */
const DEFAULT_COLLAPSED = new Set(['history']);
/** Local snapshots, caches and baselines the Studio writes under `.zcc/`: listed apart so they do not bury the project's agents. */
const HISTORY_PREFIX = '.zcc/';

export function groupExplorerNodes(nodes: ExplorerNode[], query: string): Array<{ kind: (typeof SECTION_ORDER)[number]; nodes: ExplorerNode[] }> {
  const needle = query.trim().toLowerCase();
  return SECTION_ORDER
    .map(kind => ({ kind, nodes: nodes.filter(node => node.kind === kind && (!needle || node.apiName.toLowerCase().includes(needle))) }))
    .filter(group => group.nodes.length > 0);
}

export interface OutlineUse { use: ExplorerUse; node?: ExplorerNode }
export interface OutlineAgent {
  file: PlaygroundFileRef;
  node?: ExplorerNode;
  /** What the agent references; 'unindexed' when the explorer skipped the file (agent or scan limit), null when nothing is known yet. */
  uses: OutlineUse[] | 'unindexed' | null;
  /** First path segment, shown when two agents share a name. */
  hint?: string;
}

/**
 * The outline: each project agent with the Apex, Flows, prompts, Lightning Types and components (LWC) it references, resolved to their explorer nodes
 * so they open like the catalogue rows. Agents under `.zcc/` go to `history`. Without per-agent `uses` (an older server), the
 * capped `usedBy` lists are inverted instead.
 */
export function buildAgentOutline(files: readonly PlaygroundFileRef[], nodes: readonly ExplorerNode[]): { agents: OutlineAgent[]; history: PlaygroundFileRef[] } {
  const refs = new Map<string, ExplorerNode>();
  for (const node of nodes) if ((REF_KINDS as readonly string[]).includes(node.kind)) refs.set(`${node.kind}:${node.apiName}`, node);
  const agentNodes = new Map(nodes.filter(node => node.kind === 'agent' && node.path).map(node => [node.path!, node]));
  const anyUses = nodes.some(node => node.kind === 'agent' && node.uses);
  const history = files.filter(file => file.path.startsWith(HISTORY_PREFIX));
  const project = files.filter(file => !file.path.startsWith(HISTORY_PREFIX));
  const names = new Map<string, number>();
  for (const file of project) names.set(file.apiName, (names.get(file.apiName) ?? 0) + 1);
  const agents = project.map((file): OutlineAgent => {
    const node = agentNodes.get(file.path);
    let uses: OutlineAgent['uses'];
    if (node?.uses) uses = node.uses.map(use => ({ use, node: refs.get(`${use.kind}:${use.apiName}`) }));
    else if (anyUses) uses = 'unindexed';
    else {
      const inverted = [...refs.values()].filter(ref => ref.usedBy?.includes(file.path)).map(ref => ({ use: { kind: ref.kind as RefKind, apiName: ref.apiName }, node: ref }));
      uses = inverted.length ? inverted : node ? [] : null;
    }
    return { file, node, uses, ...((names.get(file.apiName) ?? 0) > 1 ? { hint: file.path.split('/')[0] } : {}) };
  });
  return { agents, history };
}

/** Agents whose name or path matches keep every reference; otherwise only the matching references, and the agent opens to show them. */
export function filterOutline(agents: readonly OutlineAgent[], query: string): Array<OutlineAgent & { forceOpen: boolean }> {
  const needle = query.trim().toLowerCase();
  if (!needle) return agents.map(agent => ({ ...agent, forceOpen: false }));
  return agents.flatMap((agent): Array<OutlineAgent & { forceOpen: boolean }> => {
    if (`${agent.file.apiName} ${agent.file.path}`.toLowerCase().includes(needle)) return [{ ...agent, forceOpen: false }];
    if (!Array.isArray(agent.uses)) return [];
    const uses = agent.uses.filter(row => row.use.apiName.toLowerCase().includes(needle));
    return uses.length ? [{ ...agent, uses, forceOpen: true }] : [];
  });
}

/** A foldable explorer section. A filter query keeps every section open so matches are never hidden. */
function Section({ id, label, count, collapsed, onToggle, muted, children }: { id: string; label: string; count?: number; collapsed: boolean; onToggle?(id: string): void; muted?: boolean; children: ReactNode }) {
  return <div className={`sf-as-section${muted ? ' is-muted' : ''}`} data-testid={`sf-explorer-${id}`}>
    {onToggle
      ? <button type="button" className="sf-as-section-label sf-as-section-toggle" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
        <ChevronRight size={12} className="sf-as-chevron" aria-hidden="true" /><span>{label}</span>{count !== undefined && <span className="sf-as-section-count">{count}</span>}
      </button>
      : <div className="sf-as-section-label">{label}</div>}
    {!collapsed && children}
  </div>;
}

function KindIcon({ kind }: { kind: string }) {
  const Glyph = KIND_ICON[kind] ?? Braces;
  return <span className={`sf-as-kind-icon is-${kind}`} aria-hidden="true"><Glyph size={13} aria-hidden="true" /></span>;
}

const usesLabel = (count: number) => `Used by ${count} ${count === 1 ? 'agent' : 'agents'}`;

/** One reference row (outline child or catalogue entry). Prompts have no source view, so they do not open. */
function RefRow({ node, depth, onOpen, showUses }: { node: ExplorerNode; depth: 1 | 2; onOpen(node: ExplorerNode): void; showUses?: boolean }) {
  const uses = node.usedBy?.length ?? 0;
  return <button type="button" className={`sf-as-tree-btn sf-as-depth-${depth}`} disabled={node.kind === 'prompt'} onClick={() => onOpen(node)}
    title={uses ? `${node.apiName}\n${usesLabel(uses)}: ${agentSummary(node.usedBy!)}` : node.path ?? node.apiName}>
    <KindIcon kind={node.kind} />
    <span className="sf-as-tree-name">{node.apiName}</span>
    {node.kind === 'lightning-type' && node.apiName.startsWith('lightning__') ? <span className="sf-as-tree-meta" title="Standard Lightning Type">std</span> : null}
    {node.kind === 'lightning-type' && !node.path && !node.apiName.startsWith('lightning__') ? <span className="sf-as-tree-meta is-warn" title="No bundle in this project">missing</span> : null}
    {node.kind === 'lwc' && !node.path ? <span className="sf-as-tree-meta is-warn" title="No component bundle in this project">missing</span> : null}
    {showUses && uses ? <span className="sf-as-tree-meta sf-as-tree-uses" aria-label={usesLabel(uses)}>{uses}</span> : null}
    {node.badge?.status ? <span className="sf-as-tree-meta" data-testid="sf-explorer-badge" aria-label={node.badge.status === 'pass' ? 'Passing' : 'Failing'}>{node.badge.status === 'pass' ? '✓' : '✕'}</span> : null}
  </button>;
}

function AgentRow({ agent, open, active, dirty, indexing, onToggle, onOpenFile, onOpenNode }: {
  agent: OutlineAgent; open: boolean; active: boolean; dirty: boolean; indexing: boolean; onToggle(): void; onOpenFile(path: string): void; onOpenNode(node: ExplorerNode): void;
}) {
  const { file, uses } = agent;
  const expandable = uses !== null;
  const groups = Array.isArray(uses) ? REF_KINDS.map(kind => ({ kind, rows: uses.filter(row => row.use.kind === kind) })).filter(group => group.rows.length) : [];
  return <div className="sf-as-agent">
    <div className={`sf-as-tree-btn sf-as-agent-row${active ? ' is-active' : ''}`}>
      {expandable
        ? <button type="button" className="sf-as-twisty" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} what ${file.apiName} uses`} onClick={onToggle}><ChevronRight size={12} className="sf-as-chevron" aria-hidden="true" /></button>
        : <span className="sf-as-twisty" aria-hidden="true" />}
      <button type="button" className="sf-as-agent-open" data-testid={`salesforce-agent-script-file:${file.path}`} aria-current={active ? 'true' : undefined}
        title={`${file.path}\n${file.lines.toLocaleString()} lines`} onClick={() => onOpenFile(file.path)}>
        <KindIcon kind="agent" />
        <span className="sf-as-tree-name">{file.apiName}</span>
        {agent.hint && <span className="sf-as-tree-hint">{agent.hint}</span>}
        {dirty && <span className="sf-etab-dirty" role="img" aria-label="Unsaved changes">●</span>}
        {agent.node?.badge?.problems ? <span className="sf-as-tree-meta is-danger" aria-label={`${agent.node.badge.problems} problems`}>{agent.node.badge.problems}</span> : null}
        <span className="sf-as-tree-meta sf-as-hover-meta">{file.lines.toLocaleString()} lines</span>
      </button>
    </div>
    {open && expandable && <div className="sf-as-deps" role="group" aria-label={`${file.apiName} references`}>
      {uses === 'unindexed' && <div className="sf-as-dep-note">{indexing ? 'Finding references…' : 'References not indexed for this agent.'}</div>}
      {Array.isArray(uses) && uses.length === 0 && <div className="sf-as-dep-note">No Apex, Flow, prompt or type references.</div>}
      {groups.map(group => <div key={group.kind} className="sf-as-dep-group">
        <div className="sf-as-dep-label">{REF_GROUP_LABEL[group.kind]}<span>{group.rows.length}</span></div>
        {group.rows.map(row => <RefRow key={`${row.use.kind}:${row.use.apiName}`} node={row.node ?? { kind: row.use.kind, apiName: row.use.apiName }} depth={2} onOpen={onOpenNode} />)}
      </div>)}
    </div>}
  </div>;
}

/** The open agent on its own: a way back to every agent, then what it references by kind, then its local history. */
function FocusedAgent({ agent, query, total, dirty, history, activePath, collapsed, onToggleSection, onAll, onOpenFile, onOpenNode }: {
  agent: OutlineAgent; query: string; total: number; dirty: boolean; history: PlaygroundFileRef[]; activePath: string | null;
  collapsed(id: string): boolean; onToggleSection?(id: string): void; onAll(): void; onOpenFile(path: string): void; onOpenNode(node: ExplorerNode): void;
}) {
  const { file, uses } = agent;
  // As in the outline, a filter that names the agent itself (how it was found) keeps all of its references.
  const filter = query && !`${file.apiName} ${file.path}`.toLowerCase().includes(query) ? query : '';
  const rows = Array.isArray(uses) ? uses.filter(row => !filter || row.use.apiName.toLowerCase().includes(filter)) : [];
  const groups = REF_KINDS.map(kind => ({ kind, rows: rows.filter(row => row.use.kind === kind) })).filter(group => group.rows.length);
  return <>
    <button type="button" className="sf-as-tree-btn sf-as-focus-back" data-testid="sf-explorer-all-agents" title={`Show all ${total.toLocaleString()} agents in this project`} onClick={onAll}>
      <ArrowLeft size={13} aria-hidden="true" /><span className="sf-as-tree-name">All agents</span><span className="sf-as-tree-meta">{total.toLocaleString()}</span>
    </button>
    <button type="button" className="sf-as-tree-btn is-active" data-testid={`salesforce-agent-script-file:${file.path}`} aria-current="true"
      title={`${file.path}\n${file.lines.toLocaleString()} lines`} onClick={() => onOpenFile(file.path)}>
      <KindIcon kind="agent" />
      <span className="sf-as-tree-name">{file.apiName}</span>
      {dirty && <span className="sf-etab-dirty" role="img" aria-label="Unsaved changes">●</span>}
      {agent.node?.badge?.problems ? <span className="sf-as-tree-meta is-danger" aria-label={`${agent.node.badge.problems} problems`}>{agent.node.badge.problems}</span> : null}
      <span className="sf-as-tree-meta">{file.lines.toLocaleString()} lines</span>
    </button>
    {uses === null && <div className="sf-as-dep-note">Finding references…</div>}
    {uses === 'unindexed' && <div className="sf-as-dep-note">References not indexed for this agent.</div>}
    {Array.isArray(uses) && groups.length === 0 && <div className="sf-as-dep-note">{filter ? 'No matching references.' : 'No Apex, Flow, prompt or type references.'}</div>}
    {groups.map(group => <Section key={group.kind} id={`focus-${group.kind}`} label={REF_GROUP_LABEL[group.kind]} count={group.rows.length} collapsed={collapsed(`focus-${group.kind}`)} onToggle={onToggleSection}>
      {group.rows.map(row => <RefRow key={`${row.use.kind}:${row.use.apiName}`} node={row.node ?? { kind: row.use.kind, apiName: row.use.apiName }} depth={1} onOpen={onOpenNode} showUses />)}
    </Section>)}
    {history.length > 0 && <Section id="history" label="Local history" count={history.length} collapsed={collapsed('history')} onToggle={onToggleSection} muted>
      {history.map(row => <button key={row.path} type="button" className={`sf-as-tree-btn sf-as-depth-1${activePath === row.path ? ' is-active' : ''}`} data-testid={`salesforce-agent-script-file:${row.path}`}
        title={row.path} onClick={() => onOpenFile(row.path)}>
        <span className="sf-as-kind-icon is-history" aria-hidden="true"><History size={13} aria-hidden="true" /></span>
        <span className="sf-as-tree-name">{row.apiName}</span>
        <span className="sf-as-tree-hint">{row.path.slice(HISTORY_PREFIX.length).split('/')[0]}</span>
      </button>)}
    </Section>}
  </>;
}

/**
 * The Studio explorer: the project's agents, each unfolding into what it references (Apex, Flows, prompts, Lightning Types), then test
 * suites, org agents and local history. An open project agent narrows it to that agent's references until "All agents" is chosen.
 * "All references" swaps the outline for the full catalogue. The same component is the wide
 * left column and the rail's "File explorer" tool.
 */
export function Explorer({ files, nodes, activePath, dirtyPath, query, onQuery, onOpenFile, onOpenNode, onIndexAgent, indexing = [], onBrowseOrg, orgLabel, orgAgentsMore, orgAgentsNotLocal, collapsed = [], onToggleSection, onHide }: {
  files: PlaygroundFileRef[];
  nodes: ExplorerNode[];
  activePath: string | null;
  dirtyPath?: string | null;
  query: string;
  onQuery(value: string): void;
  onOpenFile(path: string): void;
  onOpenNode(node: ExplorerNode): void;
  /** An unfolded agent the explorer did not scan (past its agent or scan limit): list again with it scanned. */
  onIndexAgent?(path: string): void;
  /** Agents whose references are being listed after `onIndexAgent`. */
  indexing?: readonly string[];
  onBrowseOrg(): void;
  /** The connected org, named under the "more in the org" row. */
  orgLabel?: string;
  /** The org listed more agents than the explorer received, so its count is a floor. */
  orgAgentsMore?: boolean;
  /** Exact count of org agents not on disk, over the whole org rather than the agents the explorer received. */
  orgAgentsNotLocal?: number;
  collapsed?: readonly string[];
  onToggleSection?(id: string): void;
  /** Wide layout: folds the whole column away (the activity bar brings it back). */
  onHide?(): void;
}) {
  const [view, setView] = useState<'outline' | 'references'>('outline');
  // An open project agent focuses the outline on it; "All agents" widens it until another agent opens.
  const [wideFor, setWideFor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(activePath ? [activePath] : []));
  // Opening an agent (from anywhere) unfolds it here; folding stays the user's choice afterwards.
  useEffect(() => { if (activePath) setExpanded(current => current.has(activePath) ? current : new Set(current).add(activePath)); }, [activePath]);
  const outline = useMemo(() => buildAgentOutline(files, nodes), [files, nodes]);
  const agents = useMemo(() => filterOutline(outline.agents, query), [outline.agents, query]);
  const needle = query.trim().toLowerCase();
  const history = needle ? outline.history.filter(file => `${file.apiName} ${file.path}`.toLowerCase().includes(needle)) : outline.history;
  const groups = useMemo(() => groupExplorerNodes(nodes, query), [nodes, query]);
  const refGroups = groups.filter(group => (REF_KINDS as readonly string[]).includes(group.kind));
  // Org agents are browsed and retrieved in the Agents panel; the explorer only counts the ones not already on disk.
  const otherGroups = groups.filter(group => !(REF_KINDS as readonly string[]).includes(group.kind) && group.kind !== 'org-agent');
  const localNames = useMemo(() => new Set(files.map(file => file.apiName)), [files]);
  const listed = (groups.find(group => group.kind === 'org-agent')?.nodes ?? []).filter(node => !localNames.has(node.apiName)).length;
  // A filter can only count the agents received; unfiltered, the server's exact count wins over the capped list.
  const exact = !needle && orgAgentsNotLocal !== undefined;
  const orgOnly = exact ? orgAgentsNotLocal : listed;
  const orgCount = `${orgOnly.toLocaleString()}${!exact && orgAgentsMore && !needle ? '+' : ''}`;
  const refCount = nodes.filter(node => (REF_KINDS as readonly string[]).includes(node.kind)).length;
  const isCollapsed = (id: string) => !needle && DEFAULT_COLLAPSED.has(id) !== collapsed.includes(id);
  const focused = view === 'outline' && wideFor !== activePath ? outline.agents.find(agent => agent.file.path === activePath) : undefined;
  // Choosing the open agent again returns to its focused view.
  const focusOn = (path: string) => { if (path === activePath) setWideFor(null); onOpenFile(path); };
  const toggle = (agent: OutlineAgent) => {
    const path = agent.file.path;
    if (!expanded.has(path) && agent.uses === 'unindexed') onIndexAgent?.(path);
    setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  };

  const outlineView = <>
    <Section id="project" label="Agents in this project" count={outline.agents.length} collapsed={isCollapsed('project')} onToggle={onToggleSection}>
      {agents.length === 0
        ? <EmptyState compact art={query ? 'search' : 'code'} title={query ? 'No matching files' : 'No .agent files in this folder.'}
          action={<button className="af-text-button" type="button" onClick={onBrowseOrg}>Browse agents in your org</button>}>
          {query ? 'Try another file name.' : 'Create a local agent or retrieve a source from your org.'}
        </EmptyState>
        : agents.map(agent => <AgentRow key={agent.file.path} agent={agent} open={agent.forceOpen || expanded.has(agent.file.path)} active={activePath === agent.file.path}
          dirty={dirtyPath === agent.file.path} indexing={indexing.includes(agent.file.path)} onToggle={() => toggle(agent)} onOpenFile={focusOn} onOpenNode={onOpenNode} />)}
      {orgOnly > 0 && agents.length > 0 && <button type="button" className="sf-as-org-link" data-testid="sf-explorer-org-link" onClick={onBrowseOrg}>
        <KindIcon kind="org-agent" />
        <span className="sf-as-org-link-text">
          <span>{orgCount} more in the org</span>
          {orgLabel && <small>{orgLabel}</small>}
        </span>
        <ArrowRight size={14} className="sf-as-org-link-arrow" aria-hidden="true" />
      </button>}
    </Section>
    {otherGroups.map(group => <Section key={group.kind} id={group.kind} label={KIND_LABEL[group.kind]} count={group.nodes.length} collapsed={isCollapsed(group.kind)} onToggle={onToggleSection}>
      {group.nodes.map(node => <RefRow key={`${node.kind}:${node.apiName}:${node.path ?? ''}`} node={node} depth={1} onOpen={onOpenNode} />)}
    </Section>)}
    {history.length > 0 && <Section id="history" label="Local history" count={history.length} collapsed={isCollapsed('history')} onToggle={onToggleSection} muted>
      {history.map(file => <button key={file.path} type="button" className={`sf-as-tree-btn sf-as-depth-1${activePath === file.path ? ' is-active' : ''}`} data-testid={`salesforce-agent-script-file:${file.path}`}
        aria-current={activePath === file.path ? 'true' : undefined} title={file.path} onClick={() => onOpenFile(file.path)}>
        <span className="sf-as-kind-icon is-history" aria-hidden="true"><History size={13} aria-hidden="true" /></span>
        <span className="sf-as-tree-name">{file.apiName}</span>
        <span className="sf-as-tree-hint">{file.path.slice(HISTORY_PREFIX.length).split('/')[0]}</span>
        {dirtyPath === file.path && <span className="sf-etab-dirty" role="img" aria-label="Unsaved changes">●</span>}
      </button>)}
    </Section>}
  </>;

  const focusView = focused && <FocusedAgent agent={focused} query={needle} total={outline.agents.length} dirty={dirtyPath === focused.file.path}
    history={history.filter(file => file.apiName === focused.file.apiName)} activePath={activePath} collapsed={isCollapsed} onToggleSection={onToggleSection}
    onAll={() => setWideFor(activePath)} onOpenFile={onOpenFile} onOpenNode={onOpenNode} />;

  const referencesView = <>
    <div className="sf-as-view-head">
      <button type="button" className="icon-btn" aria-label="Back to agents" title="Back to agents" onClick={() => setView('outline')}><ArrowLeft size={14} aria-hidden="true" /></button>
      <span>All references</span>
    </div>
    {refGroups.length === 0 && <div className="sf-as-dep-note">{query ? 'No matching references.' : 'No agent references Apex, Flows, prompts or types yet.'}</div>}
    {refGroups.map(group => <Section key={group.kind} id={group.kind} label={KIND_LABEL[group.kind]} count={group.nodes.length} collapsed={isCollapsed(group.kind)} onToggle={onToggleSection}>
      {group.nodes.map(node => <RefRow key={`${node.kind}:${node.apiName}:${node.path ?? ''}`} node={node} depth={1} onOpen={onOpenNode} showUses />)}
    </Section>)}
  </>;

  return <aside className="sf-as-explorer" data-testid="salesforce-agent-script-explorer" aria-label="Agentforce files">
    <div className="sf-as-explorer-top">
      <input className="sf-as-explorer-search" aria-label="Filter Agentforce files" placeholder={focused ? `Filter ${focused.file.apiName}` : 'Filter files'} value={query} onChange={event => onQuery(event.target.value)} />
      {onHide && <button type="button" className="icon-btn sf-as-explorer-hide" aria-label="Hide explorer" title={`Hide explorer (${modShortcut('B')})`} onClick={onHide}><PanelLeftClose size={15} aria-hidden="true" /></button>}
    </div>
    <div className="sf-as-explorer-scroll">{view === 'references' ? referencesView : focusView || outlineView}</div>
    {refCount > 0 && <div className="sf-as-explorer-foot">
      <button type="button" className={`sf-as-tree-btn${view === 'references' ? ' is-active' : ''}`} aria-pressed={view === 'references'}
        onClick={() => setView(current => current === 'references' ? 'outline' : 'references')}>
        <span className="sf-as-kind-icon" aria-hidden="true"><Library size={13} aria-hidden="true" /></span>
        <span className="sf-as-tree-name">All references</span>
        <span className="sf-as-tree-meta sf-as-tree-uses">{refCount}</span>
      </button>
    </div>}
  </aside>;
}
