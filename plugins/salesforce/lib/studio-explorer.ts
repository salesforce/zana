/**
 * studio.explorer: the Studio file tree. Local .agent files, the Apex / Flow / prompt targets
 * they reference, the Lightning Types their actions declare (and the project's type bundles), the LWCs those types render
 * with, repo `tests/*.scenario.json` suites and (when an org is selected) org agents.
 * Everything is bounded and read-only; the project root always comes from the request-scoped
 * project context (never from renderer input).
 */
import { join } from 'node:path';
import { scanAgentFilesSteps, readAgentFile, type AgentFileListItem } from './agent-files.js';
import { indexProjectActionsSteps, projectActionCandidates, type ProjectActionIndex } from './action-source.js';
import { runProjectScan, runProjectScanAsync } from './dx-project.js';
import { parseActionTarget } from './agent-action-model.js';
import { OrgAgentService } from './org-agent-service.js';
import { lightningTypeBundlePath, readLightningType, readLwcBundle, referencedLightningTypes } from './lightning-types.js';
import { STUDIO_RPC, type ExplorerNode, type ExplorerUse } from './studio-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';
import type { SalesforceDeps } from './types.js';

export const EXPLORER_LIMITS = { agents: 200, scanAgents: 40, expand: 20, targets: 120, scenarios: 100, orgAgents: 100, resolveTargets: 60, lightningTypes: 150, componentTypes: 60, components: 120 } as const;

/** Local snapshots and caches the Studio writes under `.zcc/`: listed after the project's agents and never counted as a reference's user. */
const HISTORY_PREFIX = '.zcc/';

export interface ExplorerResult {
  nodes: ExplorerNode[];
  truncated: boolean;
}

const TARGET_PATTERN = /\b(apex|flow|prompt|generatePromptResponse):\/\/([A-Za-z][A-Za-z0-9_]{0,159}(?:[.][A-Za-z][A-Za-z0-9_]{0,159})?)/g;

/** Distinct `kind://Name` references in one Agent Script source. */
export function referencedTargets(source: string): Array<{ kind: 'apex' | 'flow' | 'prompt'; name: string }> {
  const seen = new Map<string, { kind: 'apex' | 'flow' | 'prompt'; name: string }>();
  for (const match of source.matchAll(TARGET_PATTERN)) {
    const kind = match[1] === 'apex' ? 'apex' : match[1] === 'flow' ? 'flow' : 'prompt';
    seen.set(`${kind}:${match[2]}`, { kind, name: match[2] });
    if (seen.size >= EXPLORER_LIMITS.targets) break;
  }
  return [...seen.values()];
}

function scenarioNodes(root: string, deps: SalesforceDeps): { nodes: ExplorerNode[]; truncated: boolean } {
  const dir = join(root, 'tests');
  let names: string[];
  try {
    if (deps.stat(dir) !== 'dir') return { nodes: [], truncated: false };
    if (deps.realpath(dir) !== join(deps.realpath(root), 'tests')) return { nodes: [], truncated: false };
    names = deps.readdir(dir);
  } catch { return { nodes: [], truncated: false }; }
  const matching = names.filter(name => name.endsWith('.scenario.json')).sort();
  return {
    truncated: matching.length > EXPLORER_LIMITS.scenarios,
    nodes: matching.slice(0, EXPLORER_LIMITS.scenarios).map(name => ({ kind: 'scenario' as const, path: `tests/${name}`, apiName: name.replace(/\.scenario\.json$/, '') }))
  };
}

/**
 * Pure, synchronous part of the explorer: no org access. `focus` is the open agent and `expand` the agents unfolded in the outline:
 * listed files among them are scanned first, then the project's agents, then `.zcc/` copies, so the agent and scan caps never leave them without references.
 */
export function buildLocalExplorer(root: string, deps: SalesforceDeps, focus = '', expand: readonly string[] = []): ExplorerResult {
  return runProjectScan(buildLocalExplorerSteps(root, deps, focus, expand));
}

export function buildLocalExplorerAsync(root: string, deps: SalesforceDeps, focus = '', expand: readonly string[] = []): Promise<ExplorerResult> {
  return runProjectScanAsync(buildLocalExplorerSteps(root, deps, focus, expand));
}

function* buildLocalExplorerSteps(root: string, deps: SalesforceDeps, focus: string, expand: readonly string[]): Generator<void, ExplorerResult> {
  let truncated = false;
  let agents: AgentFileListItem[];
  try { const scan = yield* scanAgentFilesSteps(root, deps, { allowNonDx: true, priority: [focus, ...expand] }); agents = scan.files; truncated = scan.truncated; } catch { return { nodes: [], truncated: false }; }
  const priority = [focus, ...expand.slice(0, EXPLORER_LIMITS.expand)].filter(Boolean);
  const rank = (path: string) => { const at = priority.indexOf(path); return at >= 0 ? at : priority.length + (path.startsWith(HISTORY_PREFIX) ? 1 : 0); };
  agents = agents.map((agent, order) => ({ agent, order, rank: rank(agent.path) })).sort((a, b) => a.rank - b.rank || a.order - b.order).map(row => row.agent);
  if (agents.length > EXPLORER_LIMITS.agents) { truncated = true; agents = agents.slice(0, EXPLORER_LIMITS.agents); }
  const nodes: ExplorerNode[] = agents.map(agent => ({ kind: 'agent', path: agent.path, apiName: agent.apiName }));
  const used = new Map<string, { kind: 'apex' | 'flow' | 'prompt'; name: string; by: Set<string> }>();
  const types = new Map<string, Set<string>>();
  for (const [index, agent] of agents.slice(0, EXPLORER_LIMITS.scanAgents).entries()) {
    yield;
    let content: string;
    try { content = readAgentFile(root, agent.path, deps, { allowNonDx: true }).content; } catch { continue; }
    const uses: ExplorerUse[] = [];
    // A `.zcc/` copy still lists what it references, but is not one of the project agents that use it.
    const counts = !agent.path.startsWith(HISTORY_PREFIX);
    for (const target of referencedTargets(content)) {
      const key = `${target.kind}:${target.name}`;
      const row = used.get(key) ?? { ...target, by: new Set<string>() };
      if (counts) row.by.add(agent.path);
      used.set(key, row);
      uses.push({ kind: target.kind, apiName: target.name });
    }
    for (const ref of referencedLightningTypes(content)) {
      const by = types.get(ref) ?? new Set<string>();
      if (counts) by.add(agent.path);
      types.set(ref, by);
      uses.push({ kind: 'lightning-type', apiName: ref });
    }
    nodes[index]!.uses = uses;
  }
  if (agents.length > EXPLORER_LIMITS.scanAgents) truncated = true;
  let resolved = 0;
  // One project walk serves every target: a walk per target blocked the plugin's event loop.
  let index: ProjectActionIndex | null | undefined;
  for (const row of [...used.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).slice(0, EXPLORER_LIMITS.targets)) {
    yield;
    let path: string | undefined;
    if (row.kind !== 'prompt' && parseActionTarget(`${row.kind}://${row.name}`) && resolved++ < EXPLORER_LIMITS.resolveTargets) {
      if (index === undefined) {
        try { index = yield* indexProjectActionsSteps(root, deps); } catch { index = null; }
      }
      // An unreadable project is still listed, just not openable by path.
      if (index) path = projectActionCandidates(index, `${row.kind}://${row.name}`)[0];
    }
    nodes.push({ kind: row.kind, apiName: row.name, ...(path ? { path } : {}), usedBy: [...row.by].sort().slice(0, 20) });
  }
  if (used.size > EXPLORER_LIMITS.targets) truncated = true;
  // Lightning Types: every referenced type, plus project bundles no agent uses yet.
  if (index === undefined) {
    try { index = yield* indexProjectActionsSteps(root, deps); } catch { index = null; }
  }
  const typeNodes = new Map<string, ExplorerNode>();
  for (const [ref, by] of types) {
    const path = index ? lightningTypeBundlePath(index, ref) : undefined;
    typeNodes.set(path ?? ref, { kind: 'lightning-type', apiName: ref, ...(path ? { path } : {}), usedBy: [...by].sort().slice(0, 20) });
  }
  for (const [name, paths] of index?.lightningTypes ?? []) {
    if (!typeNodes.has(paths[0])) typeNodes.set(paths[0], { kind: 'lightning-type', apiName: `c__${name}`, path: paths[0] });
  }
  const typeRows = [...typeNodes.values()].sort((a, b) => a.apiName.localeCompare(b.apiName));
  if (typeRows.length > EXPLORER_LIMITS.lightningTypes) truncated = true;
  nodes.push(...typeRows.slice(0, EXPLORER_LIMITS.lightningTypes));
  // Components: the LWCs a referenced type renders or edits with, so an agent reads through to its UI. Only referenced types are read.
  const components = new Map<string, { node: ExplorerNode; by: Set<string>; via: Set<string> }>();
  const typeComponents = new Map<string, string[]>();
  const referenced = typeRows.filter(row => row.path && types.has(row.apiName));
  if (referenced.length > EXPLORER_LIMITS.componentTypes) truncated = true;
  for (const row of index ? referenced.slice(0, EXPLORER_LIMITS.componentTypes) : []) {
    yield;
    let view: ReturnType<typeof readLightningType>;
    try { view = readLightningType(root, row.apiName, deps, index!); } catch { continue; }
    const refs = new Set<string>();
    for (const component of view.components) {
      refs.add(component.ref);
      const entry = components.get(component.ref) ?? { node: { kind: 'lwc' as const, apiName: component.ref, ...(component.path ? { path: component.path } : {}) }, by: new Set<string>(), via: new Set<string>() };
      for (const agent of row.usedBy ?? []) entry.by.add(agent);
      entry.via.add(row.apiName);
      components.set(component.ref, entry);
    }
    typeComponents.set(row.apiName, [...refs]);
  }
  for (const node of nodes) {
    if (node.kind !== 'agent' || !node.uses) continue;
    const seen = new Set<string>();
    for (const use of node.uses.filter(use => use.kind === 'lightning-type')) {
      for (const ref of typeComponents.get(use.apiName) ?? []) if (!seen.has(ref)) { seen.add(ref); node.uses.push({ kind: 'lwc', apiName: ref }); }
    }
  }
  const componentRows = [...components.values()].sort((a, b) => a.node.apiName.localeCompare(b.node.apiName));
  if (componentRows.length > EXPLORER_LIMITS.components) truncated = true;
  for (const row of componentRows.slice(0, EXPLORER_LIMITS.components)) nodes.push({ ...row.node, usedBy: [...row.by].sort().slice(0, 20), via: [...row.via].sort().slice(0, 20) });
  const scenarios = scenarioNodes(root, deps);
  nodes.push(...scenarios.nodes);
  return { nodes, truncated: truncated || scenarios.truncated };
}

export function registerStudioExplorer(studio: StudioServerContext): void {
  let orgAgents: OrgAgentService | undefined;
  const service = () => orgAgents ??= new OrgAgentService({ execSf: studio.deps.execSf, connect: () => studio.sdk.connect() });
  studio.zcc.onDispose(() => orgAgents?.dispose());
  studio.registerRpc(STUDIO_RPC.explorer, async args => {
    const context = studio.contexts.current();
    const root = context?.settings.projectRoot ?? '';
    if (!root) return rpcFailure('not_configured', 'Open a project folder to browse its Agentforce files.');
    // Only a path the listing returns is honoured, so `focus` and `expand` never read outside the project's agents.
    const expand = Array.isArray((args as { expand?: unknown } | null)?.expand) ? (args as { expand: unknown[] }).expand : [];
    const local = await buildLocalExplorerAsync(root, studio.deps, rpcString(args, 'focus').slice(0, 1000),
      expand.slice(0, EXPLORER_LIMITS.expand).filter((path): path is string => typeof path === 'string' && path.length <= 1000));
    const nodes = [...local.nodes];
    let truncated = local.truncated;
    let orgError: string | undefined;
    let orgAgentsTruncated = false;
    let orgAgentsNotLocal: number | undefined;
    if (context?.settings.defaultOrg) {
      try {
        const catalog = await service().list();
        const rows = catalog.agents.slice(0, EXPLORER_LIMITS.orgAgents);
        orgAgentsTruncated = catalog.truncated || catalog.agents.length > rows.length;
        // Counted over the whole catalog, not the capped rows, so "N more in the org" is exact.
        const localAgents = new Set(local.nodes.filter(node => node.kind === 'agent').map(node => node.apiName));
        orgAgentsNotLocal = catalog.agents.filter(agent => !localAgents.has(agent.name)).length;
        if (orgAgentsTruncated) truncated = true;
        for (const agent of rows) nodes.push({ kind: 'org-agent', apiName: agent.name });
      } catch (error) { orgError = error instanceof Error ? error.message : 'Org agents are unavailable.'; }
    }
    return { ok: true, nodes, truncated, orgAgentsTruncated, ...(orgAgentsNotLocal !== undefined ? { orgAgentsNotLocal } : {}), ...(orgError ? { orgError } : {}) };
  });
  studio.registerRpc(STUDIO_RPC.lightningType, async args => {
    const root = studio.contexts.current()?.settings.projectRoot ?? '';
    if (!root) return rpcFailure('not_configured', 'Open a project folder to read its Lightning Types.');
    const ref = rpcString(args, 'ref');
    if (!ref || ref.length > 200) return rpcFailure('invalid_argument', 'ref is required.');
    try { return { ok: true, data: readLightningType(root, ref, studio.deps, await runProjectScanAsync(indexProjectActionsSteps(root, studio.deps))) }; }
    catch (error) { return rpcFailure('lightning_type_failed', error instanceof Error ? error.message : 'The Lightning Type could not be read.'); }
  });
  studio.registerRpc(STUDIO_RPC.lwc, async args => {
    const root = studio.contexts.current()?.settings.projectRoot ?? '';
    if (!root) return rpcFailure('not_configured', 'Open a project folder to read its components.');
    const ref = rpcString(args, 'ref');
    if (!ref || ref.length > 200) return rpcFailure('invalid_argument', 'ref is required.');
    try { return { ok: true, data: readLwcBundle(ref, studio.deps, await runProjectScanAsync(indexProjectActionsSteps(root, studio.deps))) }; }
    catch (error) { return rpcFailure('lwc_failed', error instanceof Error ? error.message : 'The component could not be read.'); }
  });
}
