import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { PanelLeftClose } from 'lucide-react';
import { buildAgentScriptFileTree, defaultExpandedFolders, filterAgentScriptFileTree, type AgentScriptTreeNode } from '../../../lib/agent-script-file-tree.js';
import type { ExplorerNode } from '../../../lib/studio-contract.js';
import { EmptyState } from '../components/SalesforceState.js';
import type { PlaygroundFileRef } from '../playground-bridge.js';

export function FileTree({ nodes, depth, expanded, activePath, dirtyPath, onToggle, onOpen }: {
  nodes: AgentScriptTreeNode[];
  depth: number;
  expanded: ReadonlySet<string>;
  activePath: string | null;
  dirtyPath?: string | null;
  onToggle: (path: string) => void;
  onOpen: (path: string) => void;
}) {
  return <>
    {nodes.map(node => {
      if (node.kind === 'folder') {
        const open = expanded.has(node.path);
        return <div key={node.path} className="sf-as-tree-folder">
          <button type="button" className="sf-as-tree-btn" style={{ paddingLeft: 6 + depth * 12 }} aria-expanded={open} onClick={() => onToggle(node.path)}>
            <span aria-hidden="true">{open ? '▾' : '▸'}</span><span className="sf-as-tree-name">{node.name}</span>
          </button>
          {open ? <FileTree nodes={node.children} depth={depth + 1} expanded={expanded} activePath={activePath} dirtyPath={dirtyPath} onToggle={onToggle} onOpen={onOpen} /> : null}
        </div>;
      }
      return <button key={node.path} type="button" className={`sf-as-tree-btn${activePath === node.path ? ' is-active' : ''}`} style={{ paddingLeft: 6 + depth * 12 }}
        data-testid={`salesforce-agent-script-file:${node.path}`} aria-current={activePath === node.path ? 'true' : undefined} onClick={() => onOpen(node.path)}>
        <span className="sf-as-tree-name">{node.apiName}</span>
        {dirtyPath === node.path && <span className="sf-etab-dirty" role="img" aria-label="Unsaved changes">●</span>}
        <span className="sf-as-tree-meta">{node.lines}</span>
      </button>;
    })}
  </>;
}

const KIND_LABEL: Record<string, string> = { apex: 'Apex', flow: 'Flow', prompt: 'Prompts', 'lightning-type': 'Lightning Types', scenario: 'Tests', 'org-agent': 'Org agents' };
const SECTION_ORDER = ['apex', 'flow', 'prompt', 'lightning-type', 'scenario', 'org-agent'] as const;

/** A foldable explorer section. A filter query keeps every section open so matches are never hidden. */
function Section({ id, label, count, collapsed, onToggle, children }: { id: string; label: string; count?: number; collapsed: boolean; onToggle?(id: string): void; children: ReactNode }) {
  return <div className="sf-as-section" data-testid={`sf-explorer-${id}`}>
    {onToggle
      ? <button type="button" className="sf-as-section-label sf-as-section-toggle" aria-expanded={!collapsed} onClick={() => onToggle(id)}>
        <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span><span>{label}</span>{count !== undefined && <span className="sf-as-section-count">{count}</span>}
      </button>
      : <div className="sf-as-section-label">{label}</div>}
    {!collapsed && children}
  </div>;
}

export function groupExplorerNodes(nodes: ExplorerNode[], query: string): Array<{ kind: (typeof SECTION_ORDER)[number]; nodes: ExplorerNode[] }> {
  const needle = query.trim().toLowerCase();
  return SECTION_ORDER
    .map(kind => ({ kind, nodes: nodes.filter(node => node.kind === kind && (!needle || node.apiName.toLowerCase().includes(needle))) }))
    .filter(group => group.nodes.length > 0);
}

/**
 * The Studio explorer: the project's .agent tree and everything the agents reference (Apex, Flow,
 * prompts, Lightning Types), scenario suites and org agents. The same component is the wide left column and the rail's "File explorer" tool.
 */
export function Explorer({ files, nodes, activePath, dirtyPath, query, onQuery, onOpenFile, onOpenNode, onBrowseOrg, collapsed = [], onToggleSection, onHide }: {
  files: PlaygroundFileRef[];
  nodes: ExplorerNode[];
  activePath: string | null;
  dirtyPath?: string | null;
  query: string;
  onQuery(value: string): void;
  onOpenFile(path: string): void;
  onOpenNode(node: ExplorerNode): void;
  onBrowseOrg(): void;
  collapsed?: readonly string[];
  onToggleSection?(id: string): void;
  /** Wide layout: folds the whole column away (the activity bar brings it back). */
  onHide?(): void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  useEffect(() => { setExpanded(new Set(defaultExpandedFolders(files, activePath))); }, [files, activePath]);
  const tree = useMemo(() => filterAgentScriptFileTree(buildAgentScriptFileTree(files), query), [query, files]);
  const groups = useMemo(() => groupExplorerNodes(nodes, query), [nodes, query]);
  const isCollapsed = (id: string) => !query.trim() && collapsed.includes(id);
  return <aside className="sf-as-explorer" data-testid="salesforce-agent-script-explorer" aria-label="Agentforce files">
    <div className="sf-as-explorer-top">
      <input className="sf-as-explorer-search" aria-label="Filter Agentforce files" placeholder="Filter files" value={query} onChange={event => onQuery(event.target.value)} />
      {onHide && <button type="button" className="icon-btn sf-as-explorer-hide" aria-label="Hide explorer" title="Hide explorer (⌘B)" onClick={onHide}><PanelLeftClose size={15} aria-hidden="true" /></button>}
    </div>
    <div className="sf-as-explorer-scroll">
      <Section id="project" label="Project" collapsed={isCollapsed('project')} onToggle={onToggleSection}>
        {tree.length === 0
          ? <EmptyState compact art={query ? 'search' : 'code'} title={query ? 'No matching files' : 'No .agent files in this folder.'}
            action={<button className="af-text-button" type="button" onClick={onBrowseOrg}>Browse agents in your org</button>}>
            {query ? 'Try another file name.' : 'Create a local agent or retrieve a source from your org.'}
          </EmptyState>
          : <FileTree nodes={tree} depth={0} expanded={expanded} activePath={activePath} dirtyPath={dirtyPath} onOpen={onOpenFile}
            onToggle={path => setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; })} />}
      </Section>
      {groups.map(group => <Section key={group.kind} id={group.kind} label={KIND_LABEL[group.kind]} count={group.nodes.length} collapsed={isCollapsed(group.kind)} onToggle={onToggleSection}>
        {group.nodes.map(node => <button key={`${node.kind}:${node.apiName}:${node.path ?? ''}`} type="button" className="sf-as-tree-btn" style={{ paddingLeft: 12 }}
          title={node.usedBy?.length ? `Used by ${node.usedBy.join(', ')}` : node.path ?? node.apiName}
          disabled={node.kind === 'prompt'} onClick={() => onOpenNode(node)}>
          <span className="sf-as-tree-name">{node.apiName}</span>
          {node.kind === 'lightning-type' && node.apiName.startsWith('lightning__') ? <span className="sf-as-tree-meta" title="Standard Lightning Type">std</span> : null}
          {node.kind === 'lightning-type' && !node.path && !node.apiName.startsWith('lightning__') ? <span className="sf-as-tree-meta" title="No bundle in this project">missing</span> : null}
          {node.usedBy?.length ? <span className="sf-as-tree-meta">{node.usedBy.length}×</span> : null}
          {node.badge?.status ? <span className="sf-as-tree-meta" data-testid="sf-explorer-badge" aria-label={node.badge.status === 'pass' ? 'Passing' : 'Failing'}>{node.badge.status === 'pass' ? '✓' : '✕'}</span> : null}
        </button>)}
      </Section>)}
    </div>
  </aside>;
}
