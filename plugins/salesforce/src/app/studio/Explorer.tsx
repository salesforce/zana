import { useEffect, useMemo, useState } from 'react';
import { buildAgentScriptFileTree, defaultExpandedFolders, filterAgentScriptFileTree, type AgentScriptTreeNode } from '../../../lib/agent-script-file-tree.js';
import { AGENT_SCRIPT_EXAMPLES } from '../../../lib/agent-script-model.js';
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

const KIND_LABEL: Record<string, string> = { apex: 'Apex', flow: 'Flow', prompt: 'Prompts', scenario: 'Tests', 'org-agent': 'Org agents' };
const SECTION_ORDER = ['apex', 'flow', 'prompt', 'scenario', 'org-agent'] as const;

export function groupExplorerNodes(nodes: ExplorerNode[], query: string): Array<{ kind: (typeof SECTION_ORDER)[number]; nodes: ExplorerNode[] }> {
  const needle = query.trim().toLowerCase();
  return SECTION_ORDER
    .map(kind => ({ kind, nodes: nodes.filter(node => node.kind === kind && (!needle || node.apiName.toLowerCase().includes(needle))) }))
    .filter(group => group.nodes.length > 0);
}

/**
 * The Studio explorer: examples, the project's .agent tree and everything the agents reference (Apex, Flow,
 * prompts), scenario suites and org agents. The same component is the wide left column and the rail's "File explorer" tool.
 */
export function Explorer({ files, nodes, activePath, exampleId, dirtyPath, query, onQuery, onOpenFile, onOpenExample, onOpenNode, onBrowseOrg }: {
  files: PlaygroundFileRef[];
  nodes: ExplorerNode[];
  activePath: string | null;
  exampleId: string;
  dirtyPath?: string | null;
  query: string;
  onQuery(value: string): void;
  onOpenFile(path: string): void;
  onOpenExample(id: string): void;
  onOpenNode(node: ExplorerNode): void;
  onBrowseOrg(): void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [examplesOpen, setExamplesOpen] = useState(true);
  useEffect(() => { setExpanded(new Set(defaultExpandedFolders(files, activePath))); }, [files, activePath]);
  const tree = useMemo(() => filterAgentScriptFileTree(buildAgentScriptFileTree(files), query), [query, files]);
  const groups = useMemo(() => groupExplorerNodes(nodes, query), [nodes, query]);
  return <aside className="sf-as-explorer" data-testid="salesforce-agent-script-explorer" aria-label="Agentforce files">
    <input className="sf-as-explorer-search" aria-label="Filter Agentforce files" placeholder="Filter files" value={query} onChange={event => onQuery(event.target.value)} />
    <div className="sf-as-explorer-scroll">
      <div className="sf-as-section">
        <button type="button" className="sf-as-section-label sf-as-tree-btn" aria-expanded={examplesOpen} onClick={() => setExamplesOpen(open => !open)}>
          {examplesOpen ? '▾' : '▸'} Examples
        </button>
        {examplesOpen && AGENT_SCRIPT_EXAMPLES.map(example => <button key={example.id} type="button" className={`sf-as-tree-btn${!activePath && exampleId === example.id ? ' is-active' : ''}`}
          style={{ paddingLeft: 18 }} onClick={() => onOpenExample(example.id)}><span className="sf-as-tree-name">{example.title}</span></button>)}
      </div>
      <div className="sf-as-section">
        <div className="sf-as-section-label">Project</div>
        {tree.length === 0
          ? <EmptyState compact art={query ? 'search' : 'code'} title={query ? 'No matching files' : 'No .agent files in this folder.'}
            action={<button className="af-text-button" type="button" onClick={onBrowseOrg}>Browse agents in your org</button>}>
            {query ? 'Try another file name.' : 'Create a local agent or retrieve a source from your org.'}
          </EmptyState>
          : <FileTree nodes={tree} depth={0} expanded={expanded} activePath={activePath} dirtyPath={dirtyPath} onOpen={onOpenFile}
            onToggle={path => setExpanded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; })} />}
      </div>
      {groups.map(group => <div className="sf-as-section" key={group.kind} data-testid={`sf-explorer-${group.kind}`}>
        <div className="sf-as-section-label">{KIND_LABEL[group.kind]}</div>
        {group.nodes.map(node => <button key={`${node.kind}:${node.apiName}:${node.path ?? ''}`} type="button" className="sf-as-tree-btn" style={{ paddingLeft: 12 }}
          title={node.usedBy?.length ? `Used by ${node.usedBy.join(', ')}` : node.path ?? node.apiName}
          disabled={node.kind === 'prompt'} onClick={() => onOpenNode(node)}>
          <span className="sf-as-tree-name">{node.apiName}</span>
          {node.usedBy?.length ? <span className="sf-as-tree-meta">{node.usedBy.length}×</span> : null}
          {node.badge?.status ? <span className="sf-as-tree-meta" data-testid="sf-explorer-badge" aria-label={node.badge.status === 'pass' ? 'Passing' : 'Failing'}>{node.badge.status === 'pass' ? '✓' : '✕'}</span> : null}
        </button>)}
      </div>)}
    </div>
  </aside>;
}
