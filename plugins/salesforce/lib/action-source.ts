import { join, relative } from 'node:path';
import { parsePackageDirectories, resolveUnderRoot } from './dx-project.js';
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

/** Scan only package roots, never follow a link outside the registered project. */
export function readProjectAction(root: string, target: string, deps: SalesforceDeps, candidate?: string): ActionSource {
  const parsed = parseActionTarget(target);
  if (!parsed) throw Error('Only Apex and Flow implementation targets are supported.');
  const base: ActionSource = { origin: 'project', target, label: 'Project source', status: 'missing' };
  if (!root) return { ...base, message: 'Open a project containing Salesforce source to inspect its implementation.' };
  const realRoot = deps.realpath(root);
  const config = resolveUnderRoot(realRoot, 'sfdx-project.json', deps.realpath);
  const configText = config ? boundedRead(deps, config) : '';
  const namespace = (() => { try { return JSON.parse(configText).namespace as unknown; } catch { return null; } })();
  // Never mistake an unnamespaced local class for a managed package class.
  const names = new Set([parsed.name]);
  if (!parsed.namespace || namespace === parsed.namespace) names.add(parsed.developerName);
  const suffix = parsed.kind === 'apex' ? '.cls' : '.flow-meta.xml';
  const queue = (config ? parsePackageDirectories(configText) : ['.']).map(path => ({ path: join(realRoot, path), depth: 0 }));
  const seen = new Set<string>();
  const matches = new Set<string>();
  let visited = 0;
  let incomplete = false;
  while (queue.length && visited < 6000) {
    const next = queue.shift()!;
    const path = resolveUnderRoot(realRoot, next.path, deps.realpath);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    if (next.depth > 16) { incomplete = true; continue; }
    let children: string[];
    try { children = deps.readdir(path); } catch { continue; }
    for (const name of children) {
      if (++visited > 6000) { incomplete = true; break; }
      if (['node_modules', '.git', '.sf', '.sfdx', 'dist', '.zcc'].includes(name)) continue;
      const child = resolveUnderRoot(realRoot, join(path, name), deps.realpath);
      if (!child) continue;
      if (deps.stat(child) === 'dir') queue.push({ path: child, depth: next.depth + 1 });
      else if (name.endsWith(suffix) && names.has(name.slice(0, -suffix.length))) matches.add(relative(realRoot, child).split('\\').join('/'));
    }
  }
  if (queue.length) incomplete = true;
  const candidates = [...matches].sort();
  if (candidate && !candidates.includes(candidate)) throw Error('The selected source is not a matching implementation inside this project.');
  if (!candidate && (candidates.length > 1 || incomplete)) return { ...base, status: 'ambiguous', candidates, message: incomplete ? 'The project scan reached its limit. Choose an exact match below, or inspect the org implementation.' : 'Multiple packages contain this implementation. Choose the source to inspect.' };
  const selected = candidate ?? candidates[0];
  if (!selected) return { ...base, message: 'No matching implementation in this project. The org may contain deployed or managed source.' };
  const absolute = resolveUnderRoot(realRoot, selected, deps.realpath);
  if (!absolute) throw Error('Source path is no longer inside the project.');
  return { ...base, status: 'ready', label: selected, content: boundedRead(deps, absolute), language: parsed.kind === 'apex' ? 'apex' : 'xml', contractMessage: parsed.kind === 'apex' ? 'Inspect the org to compare the registered invocable parameters.' : undefined };
}

function record(value: unknown): Record<string, any> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}; }
function params(value: unknown): ActionParameter[] {
  return (Array.isArray(value) ? value : []).slice(0, 250).map(record).filter(v => typeof v.name === 'string').map(v => ({
    name: v.name, type: typeof v.type === 'string' ? v.type : typeof v.dataType === 'string' ? v.dataType : 'unknown', description: typeof v.description === 'string' ? v.description : '', required: v.required === true || v.isRequired === true,
  }));
}

/** One target, one pinned org, read-only Tooling/Actions API calls. */
export async function readOrgAction(org: ResolvedOrg, target: string, deps: SalesforceDeps): Promise<ActionSource> {
  const parsed = parseActionTarget(target);
  if (!parsed) throw Error('Only Apex and Flow implementation targets are supported.');
  const base: ActionSource = { origin: 'org', target, status: 'missing', label: `${org.alias || org.username} · ${parsed.kind === 'apex' ? 'Deployed Apex' : 'Active Flow'}` };
  const get = async (path: string, query?: Record<string, string>) => {
    const res = await deps.request(org, { method: 'GET', path, query, maxResponseBytes: 2_000_000 });
    if (res.status < 200 || res.status >= 300) throw Error(`Salesforce returned ${res.status}. Check source access in ${org.alias || org.username}.`);
    return record(res.json);
  };
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
  const described = contract.status === 'fulfilled' ? record(contract.value.actions?.[0] ?? contract.value) : null;
  return {
    ...base, status: body ? 'ready' : 'unavailable', content: body, language: 'apex',
    message: body ? undefined : 'Apex source is unavailable. It may be managed, missing, or restricted by permissions.',
    ...(described && Array.isArray(described.inputs) ? { inputs: params(described.inputs), outputs: params(described.outputs) } : { contractMessage: 'Registered invocable parameters could not be verified for this target.' })
  };
}
