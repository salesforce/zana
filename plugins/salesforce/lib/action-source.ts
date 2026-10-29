import { basename, join, relative } from 'node:path';
import { parsePackageDirectories, resolveUnderRoot, runProjectScan } from './dx-project.js';
import { parseActionTarget, type ActionParameter } from './agent-action-model.js';
import type { ResolvedOrg, SalesforceDeps } from './types.js';
import type { FlowVisualization } from './flow-visualizer.js';

export const ACTION_SOURCE_CAP = 750_000;
export interface ActionSource {
  origin: 'project' | 'org';
  target: string;
  status: 'ready' | 'missing' | 'ambiguous' | 'unavailable';
  label: string;
  message?: string;
  candidates?: string[];
  content?: string;
  language?: 'apex' | 'xml' | 'json';
  flow?: Record<string, unknown>;
  version?: number;
  /** An org Flow with no active version: the latest version is shown. */
  inactive?: boolean;
  inputs?: ActionParameter[];
  outputs?: ActionParameter[];
  contractMessage?: string;
  visualization?: FlowVisualization;
  visualizationError?: string;
}
function boundedRead(deps: SalesforceDeps, path: string): string {
  const content = deps.readFileBounded ? deps.readFileBounded(path, ACTION_SOURCE_CAP) : deps.readFile(path);
  if (content === null) throw Error('The source file could not be read.');
  if (content.length > ACTION_SOURCE_CAP) throw Error('This source exceeds the 750 KB preview limit.');
  return content;
}

/** Apex classes and Flows found by one bounded walk of the project's package roots. */
export interface ProjectActionIndex {
  realRoot: string;
  namespace: unknown;
  /** File name (e.g. `Foo.cls`) to project-relative paths. */
  files: Map<string, string[]>;
  /** Lightning Type bundle name (the folder under `lightningTypes/`) to project-relative bundle paths. */
  lightningTypes: Map<string, string[]>;
  /** LWC bundle name (the folder under `lwc/`) to project-relative bundle paths: the components Lightning Types render with. */
  lwc: Map<string, string[]>;
  incomplete: boolean;
  /**
   * Set when the walk stopped early: the project-relative paths of `main/default/<path>` in every package root that has it.
   * Large projects keep their source at the standard DX location, so an exact name is still found past the walk budget.
   */
  probe?(path: string, kind: 'file' | 'dir'): string[];
}

const ACTION_SUFFIXES = ['.cls', '.flow-meta.xml'];

/** Scan only package roots, never follow a link outside the registered project. */
export function indexProjectActions(root: string, deps: SalesforceDeps): ProjectActionIndex {
  return runProjectScan(indexProjectActionsSteps(root, deps));
}

export function* indexProjectActionsSteps(root: string, deps: SalesforceDeps): Generator<void, ProjectActionIndex> {
  const realRoot = deps.realpath(root);
  const config = resolveUnderRoot(realRoot, 'sfdx-project.json', deps.realpath);
  const configText = config ? boundedRead(deps, config) : '';
  const namespace = (() => { try { return JSON.parse(configText).namespace as unknown; } catch { return null; } })();
  const packageRoots = config ? parsePackageDirectories(configText) : ['.'];
  const queue = packageRoots.map(path => ({ path: join(realRoot, path), depth: 0 }));
  const seen = new Set<string>();
  const files = new Map<string, string[]>();
  const lightningTypes = new Map<string, string[]>();
  const lwc = new Map<string, string[]>();
  let visited = 0;
  let incomplete = false;
  while (queue.length && visited < 6000) {
    yield;
    const next = queue.shift()!;
    const path = resolveUnderRoot(realRoot, next.path, deps.realpath);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (next.depth > 16) { incomplete = true; continue; }
    let children: string[];
    try { children = deps.readdir(path); } catch { continue; }
    for (const name of children) {
      yield;
      if (++visited > 6000) { incomplete = true; break; }
      // Agent bundles hold no Apex or Flows, and a large project has hundreds of them.
      if (['node_modules', '.git', '.sf', '.sfdx', 'dist', '.zcc', 'aiAuthoringBundles'].includes(name)) continue;
      const child = resolveUnderRoot(realRoot, join(path, name), deps.realpath);
      if (!child) continue;
      if (deps.stat(child) === 'dir') {
        // A bundle is a leaf: record it without spending the walk budget on its channel folders or component files.
        const bundles = basename(path) === 'lightningTypes' ? lightningTypes : basename(path) === 'lwc' ? lwc : null;
        if (bundles) {
          const paths = bundles.get(name) ?? [];
          paths.push(relative(realRoot, child).split('\\').join('/'));
          bundles.set(name, paths);
        } else queue.push({ path: child, depth: next.depth + 1 });
      }
      else if (ACTION_SUFFIXES.some(suffix => name.endsWith(suffix))) {
        const paths = files.get(name) ?? [];
        paths.push(relative(realRoot, child).split('\\').join('/'));
        files.set(name, paths);
      }
    }
  }
  if (queue.length) incomplete = true;
  const index: ProjectActionIndex = { realRoot, namespace, files, lightningTypes, lwc, incomplete };
  if (incomplete) index.probe = (path, kind) => packageRoots.flatMap(root => {
    try {
      const absolute = resolveUnderRoot(realRoot, join(realRoot, root, 'main', 'default', path), deps.realpath);
      return absolute && deps.stat(absolute) === kind ? [relative(realRoot, absolute).split('\\').join('/')] : [];
    } catch { return []; }
  });
  return index;
}

/** Sorted project paths implementing `target`, from an index built by `indexProjectActions`. */
export function projectActionCandidates(index: ProjectActionIndex, target: string): string[] {
  const parsed = parseActionTarget(target);
  if (!parsed) throw Error('Only Apex and Flow implementation targets are supported.');
  // Never mistake an unnamespaced local class for a managed package class.
  const names = new Set([parsed.name]);
  if (!parsed.namespace || index.namespace === parsed.namespace) names.add(parsed.developerName);
  const suffix = parsed.kind === 'apex' ? '.cls' : '.flow-meta.xml';
  const folder = parsed.kind === 'apex' ? 'classes' : 'flows';
  const probed = [...names].flatMap(name => index.probe?.(`${folder}/${name}${suffix}`, 'file') ?? []);
  return [...new Set([...[...names].flatMap(name => index.files.get(`${name}${suffix}`) ?? []), ...probed])].sort();
}

export function readProjectAction(root: string, target: string, deps: SalesforceDeps, candidate?: string): ActionSource {
  const parsed = parseActionTarget(target);
  if (!parsed) throw Error('Only Apex and Flow implementation targets are supported.');
  const base: ActionSource = { origin: 'project', target, label: 'Project source', status: 'missing' };
  if (!root) return { ...base, message: 'Open a project containing Salesforce source to inspect its implementation.' };
  const index = indexProjectActions(root, deps);
  const { realRoot, incomplete } = index;
  const candidates = projectActionCandidates(index, target);
  if (candidate && !candidates.includes(candidate)) throw Error('The selected source is not a matching implementation inside this project.');
  // A partial walk with one match (usually the standard-path probe) opens it, so only a real choice asks the user.
  if (!candidate && candidates.length > 1) return { ...base, status: 'ambiguous', candidates, message: incomplete ? 'The project scan reached its limit. Choose an exact match below, or inspect the org implementation.' : 'Multiple packages contain this implementation. Choose the source to inspect.' };
  if (!candidates.length && incomplete) return { ...base, message: `No ${parsed.kind === 'apex' ? 'class' : 'flow'} at the standard source path, and the project is too large to search every folder. Switch to Org to inspect the deployed implementation.` };
  const selected = candidate ?? candidates[0];
  const partial = !candidate && incomplete ? { message: 'Opened from the standard source path. The project is too large to rule out another copy elsewhere.' } : {};
  if (!selected) return { ...base, message: 'No matching implementation in this project. The org may contain deployed or managed source.' };
  const absolute = resolveUnderRoot(realRoot, selected, deps.realpath);
  if (!absolute) throw Error('Source path is no longer inside the project.');
  return { ...base, ...partial, status: 'ready', label: selected, content: boundedRead(deps, absolute), language: parsed.kind === 'apex' ? 'apex' : 'xml', contractMessage: parsed.kind === 'apex' ? 'Inspect the org to compare the registered invocable parameters.' : undefined };
}

function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function params(value: unknown): ActionParameter[] {
  return (Array.isArray(value) ? value : []).slice(0, 250).map(record).filter(v => typeof v.name === 'string').map(v => ({
    name: v.name, type: typeof v.type === 'string' ? v.type : typeof v.dataType === 'string' ? v.dataType : 'unknown', description: typeof v.description === 'string' ? v.description : '', required: v.required === true || v.isRequired === true,
  }));
}

/** A read-only GET against one pinned org. */
export function orgGetter(org: ResolvedOrg, deps: SalesforceDeps) {
  return async (path: string, query?: Record<string, string>): Promise<Record<string, any>> => {
    const res = await deps.request(org, { method: 'GET', path, query, maxResponseBytes: 2_000_000 });
    if (res.status < 200 || res.status >= 300) throw Error(`Salesforce returned ${res.status}. Check source access in ${org.alias || org.username}.`);
    return record(res.json);
  };
}

/** The registered invocable contract of an Apex action, or a note when it cannot be read. */
export function apexContract(described: Record<string, any> | null): Pick<ActionSource, 'inputs' | 'outputs' | 'contractMessage'> {
  const action = described ? record(described.actions?.[0] ?? described) : null;
  return action && Array.isArray(action.inputs) ? { inputs: params(action.inputs), outputs: params(action.outputs) } : { contractMessage: 'Registered invocable parameters could not be verified for this target.' };
}

/** One target, one pinned org, read-only Tooling/Actions API calls. */
export async function readOrgAction(org: ResolvedOrg, target: string, deps: SalesforceDeps): Promise<ActionSource> {
  const parsed = parseActionTarget(target);
  if (!parsed) throw Error('Only Apex and Flow implementation targets are supported.');
  const base: ActionSource = { origin: 'org', target, status: 'missing', label: `${org.alias || org.username} · ${parsed.kind === 'apex' ? 'Deployed Apex' : 'Active Flow'}` };
  const get = orgGetter(org, deps);
  const namespace = parsed.namespace ? `'${parsed.namespace}'` : 'null';
  if (parsed.kind === 'flow') {
    const json = await get('/tooling/query', { q: `SELECT Id, VersionNumber, Metadata FROM Flow WHERE Definition.DeveloperName = '${parsed.developerName}' AND Definition.NamespacePrefix = ${namespace} AND Status = 'Active' LIMIT 1` });
    const row = record(json.records?.[0]);
    if (!row.Id) return { ...base, message: 'No accessible active version of this Flow was found.' };
    if (!row.Metadata) return { ...base, status: 'unavailable', message: 'The active Flow metadata is not available to this user.' };
    const flow = record(row.Metadata);
    const content = JSON.stringify(flow, null, 2);
    if (content.length > ACTION_SOURCE_CAP) throw Error('This Flow exceeds the 750 KB preview limit.');
    const variables = Array.isArray(flow.variables) ? flow.variables : [];
    return { ...base, status: 'ready', version: row.VersionNumber, flow, content, language: 'json', inputs: params(variables.filter((v: any) => v.isInput)), outputs: params(variables.filter((v: any) => v.isOutput)) };
  }
  const [source, contract] = await Promise.allSettled([
    get('/tooling/query', { q: `SELECT Id, Name, Body FROM ApexClass WHERE Name = '${parsed.developerName}' AND NamespacePrefix = ${namespace} LIMIT 1` }),
    get(`/actions/custom/apex/${encodeURIComponent(parsed.name)}`)
  ]);
  const row = source.status === 'fulfilled' ? record(source.value.records?.[0]) : {};
  const body = typeof row.Body === 'string' ? row.Body : undefined;
  if (body && body.length > ACTION_SOURCE_CAP) throw Error('This Apex class exceeds the 750 KB preview limit.');
  return {
    ...base, status: body ? 'ready' : 'unavailable', content: body, language: 'apex',
    message: body ? undefined : 'Apex source is unavailable. It may be managed, missing, or restricted by permissions.',
    ...apexContract(contract.status === 'fulfilled' ? contract.value : null)
  };
}
