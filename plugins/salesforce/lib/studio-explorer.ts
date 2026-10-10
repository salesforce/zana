/**
 * studio.explorer: the Studio file tree. Local .agent files, the Apex / Flow / prompt targets
 * they reference, the Lightning Types their actions declare (and the project's type bundles), repo `tests/*.scenario.json` suites and (when an org is selected) org agents.
 * Everything is bounded and read-only; the project root always comes from the request-scoped
 * project context (never from renderer input).
 */
import { join } from 'node:path';
import { listAgentFiles, readAgentFile, type AgentFileListItem } from './agent-files.js';
import { indexProjectActions, projectActionCandidates, type ProjectActionIndex } from './action-source.js';
import { parseActionTarget } from './agent-action-model.js';
import { OrgAgentService } from './org-agent-service.js';
import { lightningTypeBundlePath, readLightningType, referencedLightningTypes } from './lightning-types.js';
import { STUDIO_RPC, type ExplorerNode } from './studio-contract.js';
import { rpcFailure, rpcString, type StudioServerContext } from './studio-server-context.js';
import type { SalesforceDeps } from './types.js';

export const EXPLORER_LIMITS = { agents: 200, scanAgents: 40, targets: 120, scenarios: 100, orgAgents: 100, resolveTargets: 60, lightningTypes: 150 } as const;

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

/** Pure, synchronous part of the explorer: no org access. */
export function buildLocalExplorer(root: string, deps: SalesforceDeps): ExplorerResult {
  let truncated = false;
  let agents: AgentFileListItem[];
  try { agents = listAgentFiles(root, deps, { allowNonDx: true }); } catch { return { nodes: [], truncated: false }; }
  if (agents.length > EXPLORER_LIMITS.agents) { truncated = true; agents = agents.slice(0, EXPLORER_LIMITS.agents); }
  const nodes: ExplorerNode[] = agents.map(agent => ({ kind: 'agent', path: agent.path, apiName: agent.apiName }));
  const used = new Map<string, { kind: 'apex' | 'flow' | 'prompt'; name: string; by: Set<string> }>();
  const types = new Map<string, Set<string>>();
  for (const agent of agents.slice(0, EXPLORER_LIMITS.scanAgents)) {
    let content: string;
    try { content = readAgentFile(root, agent.path, deps, { allowNonDx: true }).content; } catch { continue; }
    for (const target of referencedTargets(content)) {
      const key = `${target.kind}:${target.name}`;
      const row = used.get(key) ?? { ...target, by: new Set<string>() };
      row.by.add(agent.path);
      used.set(key, row);
    }
    for (const ref of referencedLightningTypes(content)) types.set(ref, (types.get(ref) ?? new Set<string>()).add(agent.path));
  }
  if (agents.length > EXPLORER_LIMITS.scanAgents) truncated = true;
  let resolved = 0;
  // One project walk serves every target: a walk per target blocked the plugin's event loop.
  let index: ProjectActionIndex | null | undefined;
  for (const row of [...used.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)).slice(0, EXPLORER_LIMITS.targets)) {
    let path: string | undefined;
    if (row.kind !== 'prompt' && parseActionTarget(`${row.kind}://${row.name}`) && resolved++ < EXPLORER_LIMITS.resolveTargets) {
      if (index === undefined) {
        try { index = indexProjectActions(root, deps); } catch { index = null; }
      }
      // An unreadable project is still listed, just not openable by path.
      if (index) path = projectActionCandidates(index, `${row.kind}://${row.name}`)[0];
    }
    nodes.push({ kind: row.kind, apiName: row.name, ...(path ? { path } : {}), usedBy: [...row.by].sort().slice(0, 20) });
  }
  if (used.size > EXPLORER_LIMITS.targets) truncated = true;
  // Lightning Types: every referenced type, plus project bundles no agent uses yet.
  if (index === undefined) {
    try { index = indexProjectActions(root, deps); } catch { index = null; }
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
  const scenarios = scenarioNodes(root, deps);
  nodes.push(...scenarios.nodes);
  return { nodes, truncated: truncated || scenarios.truncated };
}

export function registerStudioExplorer(studio: StudioServerContext): void {
  let orgAgents: OrgAgentService | undefined;
  const service = () => orgAgents ??= new OrgAgentService({ execSf: studio.deps.execSf, connect: () => studio.sdk.connect() });
  studio.zcc.onDispose(() => orgAgents?.dispose());
  studio.registerRpc(STUDIO_RPC.explorer, async () => {
    const context = studio.contexts.current();
    const root = context?.settings.projectRoot ?? '';
    if (!root) return rpcFailure('not_configured', 'Open a project folder to browse its Agentforce files.');
    const local = buildLocalExplorer(root, studio.deps);
    const nodes = [...local.nodes];
    let truncated = local.truncated;
    let orgError: string | undefined;
    if (context?.settings.defaultOrg) {
      try {
        const catalog = await service().list();
        const rows = catalog.agents.slice(0, EXPLORER_LIMITS.orgAgents);
        if (catalog.truncated || catalog.agents.length > rows.length) truncated = true;
        for (const agent of rows) nodes.push({ kind: 'org-agent', apiName: agent.name });
      } catch (error) { orgError = error instanceof Error ? error.message : 'Org agents are unavailable.'; }
    }
    return { ok: true, nodes, truncated, ...(orgError ? { orgError } : {}) };
  });
  studio.registerRpc(STUDIO_RPC.lightningType, async args => {
    const root = studio.contexts.current()?.settings.projectRoot ?? '';
    if (!root) return rpcFailure('not_configured', 'Open a project folder to read its Lightning Types.');
    const ref = rpcString(args, 'ref');
    if (!ref || ref.length > 200) return rpcFailure('invalid_argument', 'ref is required.');
    try { return { ok: true, data: readLightningType(root, ref, studio.deps, indexProjectActions(root, studio.deps)) }; }
    catch (error) { return rpcFailure('lightning_type_failed', error instanceof Error ? error.message : 'The Lightning Type could not be read.'); }
  });
}
