import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { parseLightningTypeRef, referencedLightningTypes } from './lightning-types.js';
import { diffStats, lineDiff } from './line-diff.js';
import { cliResult, removeTemp, retrieveInto, sourceApiVersion, tempProject, type RetrievedFile } from './org-retrieve.js';
import {
  SCOPE_TYPES, SYNC_FETCH_MAX, SYNC_TYPES, TARGET_TYPES, agentVersion,
  type SyncAgent, type SyncCheck, type SyncComponent, type SyncDiff, type SyncJob, type SyncPlanFile, type SyncScope, type SyncState, type SyncType,
} from './org-sync-contract.js';
import type { PublicOrgView, SalesforceDeps } from './types.js';

type Page = { records?: Array<Record<string, unknown>>; done?: boolean; nextRecordsUrl?: string | null };
export interface OrgSyncDeps {
  execSf: SalesforceDeps['execSf'];
  connect(): Promise<PublicOrgView>;
  query(soql: string, opts: { tooling?: boolean; signal?: AbortSignal }): Promise<Page>;
  queryMore(nextRecordsUrl: string, opts: { signal?: AbortSignal }): Promise<Page>;
  kv: { get<T>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  /** Project-scoped storage key. */
  key(name: string): string;
  now?(): number;
}

/**
 * Where each listed type lives inside a package directory, and whether a component is a folder. Only `check` uses it,
 * to tell which org components the project already has; a fetch places files from the CLI's own retrieve result.
 */
const LAYOUT: Record<SyncType, { folder: string; bundle: boolean; ext?: string }> = {
  AiAuthoringBundle: { folder: 'aiAuthoringBundles', bundle: true },
  ApexClass: { folder: 'classes', bundle: false, ext: '.cls' },
  ApexTrigger: { folder: 'triggers', bundle: false, ext: '.trigger' },
  LightningComponentBundle: { folder: 'lwc', bundle: true },
  Flow: { folder: 'flows', bundle: false, ext: '.flow' },
  GenAiPromptTemplate: { folder: 'genAiPromptTemplates', bundle: false, ext: '.genAiPromptTemplate' },
  LightningTypeBundle: { folder: 'lightningTypes', bundle: true },
};
/** Types only the Metadata API lists, by how an error names them; the rest come from SOQL. */
const LISTED: ReadonlyMap<SyncType, string> = new Map<SyncType, string>([['AiAuthoringBundle', 'agents'], ['GenAiPromptTemplate', 'prompt templates'], ['LightningTypeBundle', 'Lightning types']]);
/** How SOQL lists a type: the object, its name field, and whether `LastModifiedBy` is already the name. */
const SOQL: Partial<Record<SyncType, { from: string; field: string; tooling?: boolean; byText?: boolean }>> = {
  ApexClass: { from: 'ApexClass', field: 'Name' },
  ApexTrigger: { from: 'ApexTrigger', field: 'Name' },
  LightningComponentBundle: { from: 'LightningComponentBundle', field: 'DeveloperName', tooling: true },
  Flow: { from: 'FlowDefinitionView', field: 'ApiName', byText: true },
};
/** Most components one agent check names per type, so its SOQL `IN` lists stay short. */
const AGENT_REFS = 500;
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,254}$/;
/** Components per retrieve. Smaller batches report progress more often and run side by side. */
const BATCH = 250;
/** Retrieves running at once, each into its own temp project so CLI processes never share a folder. */
const RETRIEVERS = 3;
const LIST_ROWS = 20_000;
const RESULT_ROWS = 10_000;
const WALK_ENTRIES = 200_000;
const DIFF_CHARS = 256_000;
const DIFF_STATS_FILES = 300;
const RETRIEVE_TIMEOUT = 900_000;
const JOB_TTL = 15 * 60_000;
const CHECK_CACHE = 8;

type Mark = { at: string | null; files: Record<string, string> };
type Marks = Record<string, Mark>;
type OrgRow = { name: string; at: string | null; by: string | null };
type Local = { folder: string };
type Only = Map<SyncType, Set<string>>;
type PlanEntry = SyncPlanFile & { source: string; target: string; localSha: string | null; orgSha: string };
type Job = {
  root: string;
  org: PublicOrgView;
  at: number;
  controller: AbortController;
  temporary: string[];
  plan?: PlanEntry[];
  /** The one apply of this plan, shared by any repeat. */
  applying?: Promise<SyncJob>;
  dates: Map<string, string | null>;
  result: SyncJob;
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex').slice(0, 32);
const iso = (value: unknown) => {
  const time = typeof value === 'string' ? Date.parse(value.replace(/\+0000$/, 'Z')) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
};
const posix = (root: string, path: string) => relative(root, path).split(sep).join('/');
const errorText = (error: unknown, fallback: string) => error instanceof Error && error.message ? error.message.slice(0, 400) : fallback;
const inside = (root: string, path: string) => path === root || path.startsWith(root + sep);

async function readOptional(path: string): Promise<Buffer | null> {
  try {
    if ((await lstat(path)).isSymbolicLink()) throw Error(`${basename(path)} is a symbolic link. Replace it with a file before fetching.`);
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Package directories from sfdx-project.json, the default one first. */
export function packageDirectories(text: string): string[] {
  try {
    const rows = record(JSON.parse(text)).packageDirectories;
    const dirs = (Array.isArray(rows) ? rows : []).map(record).filter(row => typeof row.path === 'string' && row.path.trim());
    dirs.sort((a, b) => Number(b.default === true) - Number(a.default === true));
    const paths = dirs.map(row => String(row.path).trim());
    return paths.length ? paths : ['force-app'];
  } catch { return ['force-app']; }
}

/** The component a path under a type folder belongs to, or null when it is not one. */
export function componentName(type: SyncType, rest: string): string | null {
  const [first, ...more] = rest.split('/');
  if (!first) return null;
  const layout = LAYOUT[type];
  if (layout.bundle) return more.length && NAME.test(first) ? first : null;
  if (more.length) return null;
  const name = first.replace(/-meta\.xml$/, '');
  if (!name.endsWith(layout.ext!)) return null;
  const bare = name.slice(0, -layout.ext!.length);
  return NAME.test(bare) ? bare : null;
}

/**
 * `Type:Name` keys of the components an agent script uses, in first-seen order: what its actions call, then the
 * custom Lightning types its inputs and outputs declare. Standard and other-namespace types have no local bundle.
 */
export function agentReferences(source: string): string[] {
  const keys = new Set<string>();
  for (const [, scheme, name] of source.matchAll(/\b([A-Za-z]+):\/\/([A-Za-z][A-Za-z0-9_]*)/g)) {
    const type = TARGET_TYPES[scheme!];
    if (type && NAME.test(name!)) keys.add(`${type}:${name}`);
  }
  for (const ref of referencedLightningTypes(source)) {
    const parsed = parseLightningTypeRef(ref);
    if (parsed && !parsed.standard && !parsed.namespace && NAME.test(parsed.bundle)) keys.add(`LightningTypeBundle:${parsed.bundle}`);
  }
  return [...keys];
}

export { agentVersion };

/**
 * The org can return an agent version under its base name (seen for a version without a target).
 * When exactly one requested version of that agent came back that way, file it under the requested version.
 */
export function bareVersions(retrieved: Array<string | null>, keys: Set<string>): Map<string, string> {
  const names = new Set(retrieved.filter((name): name is string => Boolean(name)));
  const aliases = new Map<string, string>();
  for (const name of names) {
    if (keys.has(`AiAuthoringBundle:${name}`)) continue;
    const candidates = [...keys].filter(key => key.startsWith('AiAuthoringBundle:')).map(key => key.slice('AiAuthoringBundle:'.length))
      .filter(version => !names.has(version) && agentVersion(version).version > 0 && agentVersion(version).base === name);
    if (candidates.length === 1) aliases.set(name, candidates[0]!);
  }
  return aliases;
}

/** `Base/Base.agent` → `Base_3/Base_3.agent`. */
export function renameBundle(rest: string, from: string, to: string): string {
  const [, ...more] = rest.split('/');
  const file = more.pop()!;
  return [to, ...more, file.startsWith(`${from}.`) ? to + file.slice(from.length) : file].join('/');
}

export { manifest } from './org-retrieve.js';

/**
 * Retrieve batches of at most `size` keys. The org returns every agent version under its base folder, so two
 * versions of one agent in a retrieve overwrite each other: each batch holds at most one version per agent.
 */
export function retrieveBatches(keys: string[], size = BATCH): string[][] {
  const batches: Array<{ keys: string[]; agents: Set<string> }> = [];
  for (const key of keys) {
    const agent = key.startsWith('AiAuthoringBundle:') ? agentVersion(key.slice('AiAuthoringBundle:'.length)).base : undefined;
    let batch = batches.find(row => row.keys.length < size && (agent === undefined || !row.agents.has(agent)));
    if (!batch) batches.push(batch = { keys: [], agents: new Set() });
    batch.keys.push(key);
    if (agent !== undefined) batch.agents.add(agent);
  }
  return batches.map(batch => batch.keys);
}

/**
 * Moves one batch's files out of the retrieve folder, so a later batch that returns the same folder cannot replace
 * them, and files an agent version the org returned under its base name under the requested version.
 */
async function stage(project: string, index: number, keys: string[], files: RetrievedFile[]): Promise<RetrievedFile[]> {
  const aliases = bareVersions(files.filter(file => file.type === 'AiAuthoringBundle').map(file => file.fullName.split('/')[0]!), new Set(keys));
  const staged: RetrievedFile[] = [];
  for (const file of files) {
    let fullName = file.fullName;
    let rest = file.rest;
    const name = fullName.split('/')[0]!;
    const alias = file.type === 'AiAuthoringBundle' ? aliases.get(name) : undefined;
    if (alias) {
      const [folder, ...more] = rest.split('/');
      rest = `${folder}/${renameBundle(more.join('/'), name, alias)}`;
      fullName = alias;
    }
    const path = join(project, 'batches', String(index), ...rest.split('/'));
    await mkdir(dirname(path), { recursive: true });
    await rename(file.path, path);
    staged.push({ ...file, fullName, rest, path });
  }
  return staged;
}

/**
 * Fetch latest. A check compares org modification dates with the last fetch recorded here.
 * A fetch retrieves into a private temp project and plans each file; nothing in the project
 * changes until apply, which never overwrites local edits the operator did not choose to replace.
 */
export class OrgSyncService {
  private readonly jobs = new Map<string, Job>();
  private readonly checks = new Map<string, Map<string, string | null>>();
  private writes: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private readonly deps: OrgSyncDeps) {}

  dispose() {
    this.disposed = true;
    for (const id of [...this.jobs.keys()]) void this.drop(id);
  }

  async check(projectRoot: string, scope: SyncScope, signal?: AbortSignal): Promise<SyncCheck> {
    const root = await this.root(projectRoot);
    const org = await this.deps.connect();
    return this.compare(root, org, scope, SCOPE_TYPES[scope], undefined, signal);
  }

  /**
   * One agent and what it depends on: the bundle, the newest org version of it when that is newer than every
   * local version, the Apex, Flows and prompt templates its actions call, and its custom Lightning types. References come from the local file.
   */
  async checkAgent(projectRoot: string, agent: string, signal?: AbortSignal): Promise<SyncCheck> {
    if (!NAME.test(agent)) throw Error('Choose an agent bundle name.');
    const root = await this.root(projectRoot);
    const bundles = (await this.localIndex(root, ['AiAuthoringBundle'])).get('AiAuthoringBundle')!;
    const local = bundles.get(agent);
    if (!local) throw Error(`${agent} is not in this project. Open a local agent to fetch what it uses.`);
    const source = (await readOptional(join(local.folder, agent, `${agent}.agent`)))?.toString('utf8') ?? '';
    const org = await this.deps.connect();
    const only: Only = new Map();
    for (const key of agentReferences(source)) {
      const [type, name] = key.split(':') as [SyncType, string];
      const names = only.get(type) ?? new Set<string>();
      if (names.size < AGENT_REFS) only.set(type, names.add(name));
    }
    only.set('AiAuthoringBundle', new Set([agent]));
    return this.compare(root, org, 'all', SYNC_TYPES.filter(type => only.has(type)), only, signal, agent);
  }

  /** Org rows against local files and the last fetch. `only` narrows each type to names; `agent` also keeps its newest org version. */
  private async compare(root: string, org: PublicOrgView, scope: SyncScope, types: readonly SyncType[], only: Only | undefined, signal: AbortSignal | undefined, agent?: string): Promise<SyncCheck> {
    const [local, listed] = await Promise.all([this.localIndex(root, types), Promise.all(types.map(type => this.list(type, org, signal, only?.get(type))))]);
    const components: SyncComponent[] = [];
    const current: SyncAgent['current'] = [];
    const counts: SyncCheck['counts'] = { changed: 0, conflict: 0, unknown: 0, new: 0, deleted: 0, current: 0 };
    const dates = new Map<string, string | null>();
    const seen = new Set<string>();
    const add = (type: SyncType, row: OrgRow, state: SyncState, latest = false) => {
      counts[state]++;
      components.push({ key: `${type}:${row.name}`, type, fullName: row.name, state, modifiedAt: row.at, modifiedBy: row.by, ...(latest ? { latest } : {}) });
    };
    for (const [index, type] of types.entries()) {
      const marks = await this.marks(org.orgId, type);
      const here = local.get(type)!;
      const inOrg = new Set<string>();
      const newest = type === 'AiAuthoringBundle' ? newestVersions(listed[index]!, here) : new Set<string>();
      const wanted = only?.get(type);
      const base = agent === undefined ? undefined : agentVersion(agent).base;
      const rows = listed[index]!.filter(row => !wanted || wanted.has(row.name) || (newest.has(row.name) && agentVersion(row.name).base === base));
      for (const row of rows) {
        inOrg.add(row.name);
        seen.add(`${type}:${row.name}`);
        dates.set(`${type}:${row.name}`, row.at);
        const mark = marks[row.name];
        if (!here.has(row.name)) add(type, row, 'new', newest.has(row.name));
        else if (!mark) add(type, row, 'unknown');
        else if (mark.at && row.at && Date.parse(row.at) <= Date.parse(mark.at)) {
          counts.current++;
          if (current.length < RESULT_ROWS) current.push({ key: `${type}:${row.name}`, type, fullName: row.name, modifiedAt: row.at, modifiedBy: row.by });
        }
        else add(type, row, await locallyChanged(root, mark) ? 'conflict' : 'changed');
      }
      for (const name of Object.keys(marks)) if (!inOrg.has(name) && here.has(name) && (!wanted || wanted.has(name))) add(type, { name, at: null, by: null }, 'deleted');
    }
    const key = `${root}\0${org.orgId}`;
    this.checks.delete(key);
    this.checks.set(key, dates);
    while (this.checks.size > CHECK_CACHE) this.checks.delete(this.checks.keys().next().value!);
    const rank: Record<SyncState, number> = { conflict: 0, changed: 1, new: 2, unknown: 3, deleted: 4 };
    components.sort((a, b) => rank[a.state] - rank[b.state] || Number(b.latest ?? false) - Number(a.latest ?? false) || (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || a.key.localeCompare(b.key));
    const result: SyncCheck = { org: { alias: org.alias, orgId: org.orgId }, scope, checkedAt: (this.deps.now ?? Date.now)(), components: components.slice(0, RESULT_ROWS), counts, truncated: components.length > RESULT_ROWS || counts.current > current.length, current };
    if (agent === undefined || !only) return result;
    const missing = [...only].filter(([type]) => type !== 'AiAuthoringBundle')
      .flatMap(([type, names]) => [...names].filter(name => !seen.has(`${type}:${name}`) && !local.get(type)!.has(name)).map(name => `${type}:${name}`));
    return { ...result, agent: { name: agent, current, missing } };
  }

  async start(projectRoot: string, input: unknown): Promise<{ jobId: string }> {
    const args = record(input);
    const keys = Array.isArray(args.components) ? [...new Set(args.components)] : [];
    if (!keys.length) throw Error('Choose at least one component to fetch.');
    if (keys.length > SYNC_FETCH_MAX) throw Error(`Fetch at most ${SYNC_FETCH_MAX.toLocaleString('en-US')} components at a time.`);
    for (const key of keys) {
      const [type, name, extra] = typeof key === 'string' ? key.split(':') : [];
      if (extra !== undefined || !SYNC_TYPES.includes(type as SyncType) || !name || !NAME.test(name)) throw Error('Choose components from the latest check.');
    }
    const root = await this.root(projectRoot);
    const org = await this.deps.connect();
    if (typeof args.orgId === 'string' && args.orgId !== org.orgId) throw Error('The target org changed. Check again before fetching.');
    if (this.disposed) throw Error('The Salesforce plugin is restarting. Retry shortly.');
    this.sweep();
    const running = [...this.jobs.values()].filter(job => job.result.state === 'running');
    if (running.length >= 2 || running.some(job => job.root === root)) throw Error('A fetch is already running. Wait for it to finish.');
    const jobId = randomUUID();
    const job: Job = { root, org, at: (this.deps.now ?? Date.now)(), controller: new AbortController(), temporary: [], dates: new Map(this.checks.get(`${root}\0${org.orgId}`) ?? []), result: { state: 'running', phase: 'retrieve', done: 0, total: keys.length } };
    this.jobs.set(jobId, job);
    void this.fetch(job, keys as string[]).then(
      result => { if (this.jobs.get(jobId) === job) job.result = result; },
      async error => {
        if (this.jobs.get(jobId) !== job) return;
        job.result = { state: 'failed', error: job.controller.signal.aborted ? 'The fetch was cancelled.' : errorText(error, 'Could not fetch from the org.') };
        await this.clean(job);
      },
    ).catch(() => {});
    return { jobId };
  }

  async status(projectRoot: string, jobId: string): Promise<SyncJob> {
    return (await this.job(projectRoot, jobId)).result;
  }

  async diff(projectRoot: string, jobId: string, path: string): Promise<SyncDiff> {
    const job = await this.job(projectRoot, jobId);
    const entry = job.plan?.find(file => file.path === path);
    if (job.result.state !== 'ready' || !entry) throw Error('This file is not part of the fetch.');
    const [local, org] = await Promise.all([entry.target, entry.source].map(async file => (await readOptional(file))?.toString('utf8') ?? ''));
    const truncated = local!.length > DIFF_CHARS || org!.length > DIFF_CHARS;
    return { path, local: local!.slice(0, DIFF_CHARS), org: org!.slice(0, DIFF_CHARS), ...(truncated ? { truncated } : {}) };
  }

  /**
   * Writes safe files and the conflicts the operator chose to replace, then records what was fetched.
   * A repeated apply (a second click, or a retry after a lost answer) gets the first one's outcome.
   */
  async apply(projectRoot: string, jobId: string, input: unknown): Promise<SyncJob> {
    const job = await this.job(projectRoot, jobId);
    if (job.applying) return job.applying;
    if (job.result.state !== 'ready' || !job.plan) throw Error('This fetch has no plan to apply.');
    const chosen = record(input).take;
    const take = new Set(Array.isArray(chosen) ? chosen.filter((path): path is string => typeof path === 'string') : []);
    const plan = job.plan;
    job.plan = undefined;
    job.applying = this.write(job, plan, take);
    return job.applying;
  }

  private async write(job: Job, plan: PlanEntry[], take: Set<string>): Promise<SyncJob> {
    const skipped: Array<{ path: string; reason: string }> = [];
    const failed = new Set<string>();
    let written = 0, kept = 0;
    try {
      for (const entry of plan) {
        if (entry.action === 'same') continue;
        if (entry.action === 'conflict' && !take.has(entry.path)) { kept++; continue; }
        try {
          const current = await readOptional(entry.target);
          if ((current ? sha(current) : null) !== entry.localSha) throw Error('Changed after review');
          await writeConfined(job.root, entry.target, await readFile(entry.source));
          written++;
        } catch (error) {
          failed.add(entry.key);
          skipped.push({ path: entry.path, reason: errorText(error, 'Could not write') });
        }
      }
      // A kept conflict records the org copy too: the next check then sees the local edit as newer.
      const fetched = new Map<string, Record<string, string>>();
      for (const entry of plan) if (!failed.has(entry.key)) fetched.set(entry.key, { ...fetched.get(entry.key), [entry.path]: entry.orgSha });
      await this.record(job.org.orgId, [...fetched].map(([key, files]) => ({ key, mark: { at: job.dates.get(key) ?? null, files } })));
      job.result = { state: 'applied', written, kept, skipped };
    } catch (error) {
      job.result = { state: 'failed', error: `Wrote ${written.toLocaleString('en-US')} file${written === 1 ? '' : 's'}, then failed: ${errorText(error, 'could not record the fetch.')}` };
    } finally {
      await this.clean(job);
    }
    return job.result;
  }

  async cancel(projectRoot: string, jobId: string) {
    await this.job(projectRoot, jobId);
    await this.drop(jobId);
  }

  private async fetch(job: Job, keys: string[]): Promise<SyncJob> {
    let text: string | undefined;
    try { text = await readFile(join(job.root, 'sfdx-project.json'), 'utf8'); } catch { /* the org's version */ }
    const apiVersion = sourceApiVersion(text) ?? job.org.apiVersion;
    const batches = retrieveBatches(keys);
    // One failed retrieve stops the others instead of leaving CLI processes running.
    const stop = new AbortController();
    const signal = AbortSignal.any([job.controller.signal, stop.signal]);
    const retrieved: RetrievedFile[][] = [];
    let next = 0;
    let done = 0;
    let failure: unknown;
    const retriever = async () => {
      const temporary = await tempProject(apiVersion, 'zcc-sf-sync-');
      job.temporary.push(temporary);
      while (next < batches.length) {
        signal.throwIfAborted();
        const index = next++;
        const batch = batches[index]!;
        const result = await retrieveInto(this.deps.execSf, temporary, batch, { alias: job.org.alias, apiVersion, timeoutMs: RETRIEVE_TIMEOUT, signal });
        retrieved[index] = await stage(temporary, index, batch, result.files);
        for (const [key, at] of result.modified) if (at && !job.dates.get(key)) job.dates.set(key, at);
        done += batch.length;
        if (job.result.state === 'running') job.result = { ...job.result, done };
      }
    };
    // Every retriever settles before a failure surfaces, so cleanup never races a CLI still writing.
    await Promise.all(Array.from({ length: Math.min(RETRIEVERS, batches.length) }, () => retriever().catch(error => {
      failure ??= error;
      stop.abort();
    })));
    if (failure !== undefined) {
      await this.clean(job);
      throw failure;
    }
    if (job.result.state === 'running') job.result = { ...job.result, phase: 'compare' };
    const plan = await this.plan(job, new Set(keys), retrieved.flat());
    job.controller.signal.throwIfAborted();
    job.plan = plan;
    const found = new Set(plan.map(file => file.key));
    return {
      state: 'ready',
      org: { alias: job.org.alias, orgId: job.org.orgId },
      files: plan.map(({ path, key, action, added, removed }) => ({ path, key, action, ...(added !== undefined ? { added, removed } : {}) })),
      components: found.size,
      missing: keys.filter(key => !found.has(key)),
    };
  }

  /** Each retrieved file goes where the project already keeps that component, else under the default package directory. */
  private async plan(job: Job, keys: Set<string>, files: RetrievedFile[]): Promise<PlanEntry[]> {
    const byKey = new Map<string, Array<{ source: string; rest: string }>>();
    for (const file of files) {
      const key = `${file.type}:${file.fullName.split('/')[0]}`;
      if (keys.has(key)) byKey.set(key, [...(byKey.get(key) ?? []), { source: file.path, rest: file.rest }]);
    }
    const locate = await localLocator(job.root);
    const target = await defaultFolder(job.root);
    const plan: PlanEntry[] = [];
    let measured = 0;
    for (const [key, parts] of byKey) {
      const [type, name] = key.split(':') as [SyncType, string];
      const marks = await this.marks(job.org.orgId, type);
      const base = locate(parts.map(part => part.rest)) ?? target;
      for (const { source, rest } of parts) {
        const destination = resolve(base, rest);
        if (!destination.startsWith(job.root + sep)) continue;
        const path = posix(job.root, destination);
        // An unreadable local file (a symlink) is a conflict; apply refuses to write through it.
        const [org, current] = await Promise.all([readFile(source), readOptional(destination).catch(() => undefined)]);
        const localSha = current ? sha(current) : null;
        const action: PlanEntry['action'] = current === undefined ? 'conflict'
          : !current ? 'create'
          : current.equals(org) ? 'same'
          : marks[name]?.files[path] === localSha ? 'update' : 'conflict';
        const entry: PlanEntry = { path, key, action, source, target: destination, localSha, orgSha: sha(org) };
        if (current && action !== 'same' && measured++ < DIFF_STATS_FILES) {
          const lines = lineDiff(current.toString('utf8'), org.toString('utf8'));
          if (lines) Object.assign(entry, diffStats(lines));
        }
        plan.push(entry);
      }
    }
    const order: Record<PlanEntry['action'], number> = { conflict: 0, update: 1, create: 2, same: 3 };
    return plan.sort((a, b) => order[a.action] - order[b.action] || a.path.localeCompare(b.path));
  }

  private async root(projectRoot: string): Promise<string> {
    if (!projectRoot.trim()) throw Error('Open a Salesforce DX project before fetching from the org.');
    const root = await realpath(projectRoot);
    if (!(await readOptional(join(root, 'sfdx-project.json')))) throw Error('This project has no sfdx-project.json.');
    return root;
  }

  /** Local components of each type, keyed by name, found by walking the confined package directories. */
  private async localIndex(root: string, types: readonly SyncType[]): Promise<Map<SyncType, Map<string, Local>>> {
    const index = new Map(types.map(type => [type, new Map<string, Local>()]));
    const byFolder = new Map(types.map(type => [LAYOUT[type].folder, type]));
    let entries = 0;
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 12) return;
      let children;
      try { children = await readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const child of children) {
        if (++entries > WALK_ENTRIES) throw Error('This project has too many files to compare. Narrow its package directories.');
        if (!child.isDirectory() || child.name.startsWith('.') || child.name === 'node_modules') continue;
        const path = join(dir, child.name);
        const type = byFolder.get(child.name);
        if (!type) { await walk(path, depth + 1); continue; }
        const found = index.get(type)!;
        for (const item of await readdir(path, { withFileTypes: true })) {
          const bundle = LAYOUT[type].bundle;
          const name = componentName(type, bundle ? `${item.name}/_` : item.name);
          if (name && item.isDirectory() === bundle && !found.has(name)) found.set(name, { folder: path });
        }
      }
    };
    const text = await readFile(join(root, 'sfdx-project.json'), 'utf8');
    for (const dir of packageDirectories(text)) {
      let real: string;
      try { real = await realpath(resolve(root, dir)); } catch { continue; }
      if (!inside(root, real)) throw Error('A package directory is outside this project.');
      await walk(real, 0);
    }
    return index;
  }

  private async list(type: SyncType, org: PublicOrgView, signal?: AbortSignal, names?: Set<string>): Promise<OrgRow[]> {
    if (names && !names.size) return [];
    if (LISTED.has(type)) {
      const rows = cliResult(await this.deps.execSf(['org', 'list', 'metadata', '--metadata-type', type, '--target-org', org.alias, '--json'], { timeoutMs: 60_000, signal }), `Salesforce could not list ${LISTED.get(type)}. Check your org access and retry.`);
      return (Array.isArray(rows) ? rows : []).slice(0, LIST_ROWS).map(record)
        .filter(row => !row.namespacePrefix && row.manageableState !== 'installed' && typeof row.fullName === 'string' && NAME.test(row.fullName))
        .map(row => ({ name: String(row.fullName), at: iso(row.lastModifiedDate), by: typeof row.lastModifiedByName === 'string' ? row.lastModifiedByName : null }));
    }
    // SOQL takes seconds where listMetadata takes a minute on orgs with many managed classes.
    const { from, field, tooling = false, byText = false } = SOQL[type]!;
    const by = byText ? 'LastModifiedBy' : 'LastModifiedBy.Name';
    // Names passed NAME, so they are safe inside the quoted IN list.
    const filter = names ? ` AND ${field} IN (${[...names].map(name => `'${name}'`).join(', ')})` : '';
    let page = await this.deps.query(`SELECT ${field}, LastModifiedDate, ${by} FROM ${from} WHERE NamespacePrefix = null${filter} ORDER BY ${field}`, { tooling, signal });
    const rows = [...(page.records ?? [])];
    while (!page.done && page.nextRecordsUrl && rows.length < LIST_ROWS) {
      page = await this.deps.queryMore(page.nextRecordsUrl, { signal });
      rows.push(...(page.records ?? []));
    }
    return rows.slice(0, LIST_ROWS).filter(row => typeof row[field] === 'string' && NAME.test(row[field] as string)).map(row => {
      const name = byText ? row.LastModifiedBy : record(row.LastModifiedBy).Name;
      return { name: row[field] as string, at: iso(row.LastModifiedDate), by: typeof name === 'string' ? name : null };
    });
  }

  private markKey(orgId: string, type: SyncType) { return this.deps.key(`sync:${orgId}:${type}`); }
  private async marks(orgId: string, type: SyncType): Promise<Marks> {
    return record(await this.deps.kv.get<Marks>(this.markKey(orgId, type))) as Marks;
  }

  /** One read-modify-write at a time, so two applies cannot drop each other's records. */
  private record(orgId: string, updates: Array<{ key: string; mark: Mark }>): Promise<void> {
    const run = this.writes.then(async () => {
      const byType = new Map<SyncType, typeof updates>();
      for (const update of updates) {
        const type = update.key.split(':')[0] as SyncType;
        byType.set(type, [...(byType.get(type) ?? []), update]);
      }
      for (const [type, rows] of byType) {
        const marks = await this.marks(orgId, type);
        for (const { key, mark } of rows) marks[key.slice(type.length + 1)] = mark;
        await this.deps.kv.set(this.markKey(orgId, type), marks);
      }
    });
    this.writes = run.catch(() => {});
    return run;
  }

  private async job(projectRoot: string, jobId: string): Promise<Job> {
    this.sweep();
    const job = this.jobs.get(jobId);
    if (!job || job.root !== await realpath(projectRoot)) throw Error('This fetch is unavailable in the current project. Check again.');
    return job;
  }

  /** Finished plans hold a temp copy of org files; they expire unapplied. */
  private sweep() {
    const now = (this.deps.now ?? Date.now)();
    for (const [id, job] of this.jobs) if (job.result.state !== 'running' && now - job.at > JOB_TTL) void this.drop(id);
  }

  private async drop(jobId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    this.jobs.delete(jobId);
    job.controller.abort();
    await this.clean(job);
  }

  private async clean(job: Job) {
    const temporary = job.temporary.splice(0);
    job.plan = undefined;
    await Promise.all(temporary.map(removeTemp));
  }
}

/** The newest org version of each agent this project has, when it is newer than every local version. */
export function newestVersions(rows: OrgRow[], local: Map<string, unknown>): Set<string> {
  const newest = new Map<string, { name: string; version: number }>();
  for (const row of rows) {
    const { base, version } = agentVersion(row.name);
    if (version > (newest.get(base)?.version ?? -1)) newest.set(base, { name: row.name, version });
  }
  const top = new Map<string, number>();
  for (const name of local.keys()) {
    const { base, version } = agentVersion(name);
    top.set(base, Math.max(top.get(base) ?? -1, version));
  }
  return new Set([...newest].filter(([base, row]) => top.has(base) && row.version > top.get(base)!).map(([, row]) => row.name));
}

async function locallyChanged(root: string, mark: Mark): Promise<boolean> {
  for (const [path, expected] of Object.entries(mark.files)) {
    const current = await readOptional(resolve(root, path)).catch(() => undefined);
    if (!current || sha(current) !== expected) return true;
  }
  return false;
}

/**
 * Finds where the project keeps a component from its retrieved paths (`classes/Foo.cls`, `lwc/card/card.js`):
 * the first package-directory file ending in one of them, default package first. Type-agnostic, so new metadata
 * types need no folder table.
 */
export async function localLocator(root: string): Promise<(rests: string[]) => string | undefined> {
  const byName = new Map<string, string[]>();
  let entries = 0;
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 16) return;
    let children;
    try { children = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      if (++entries > WALK_ENTRIES) throw Error('This project has too many files to compare. Narrow its package directories.');
      if (child.name.startsWith('.') || child.name === 'node_modules') continue;
      const path = join(dir, child.name);
      if (child.isDirectory()) await walk(path, depth + 1);
      else if (child.isFile()) byName.set(child.name, [...(byName.get(child.name) ?? []), path]);
    }
  };
  for (const dir of packageDirectories(await readFile(join(root, 'sfdx-project.json'), 'utf8'))) {
    let real: string;
    try { real = await realpath(resolve(root, dir)); } catch { continue; }
    if (!inside(root, real)) throw Error('A package directory is outside this project.');
    await walk(real, 0);
  }
  return rests => {
    for (const rest of rests) {
      const tail = sep + rest.split('/').join(sep);
      const match = byName.get(basename(rest))?.find(path => path.endsWith(tail));
      if (match) return match.slice(0, -tail.length);
    }
    return undefined;
  };
}

async function defaultFolder(root: string): Promise<string> {
  const [first] = packageDirectories(await readFile(join(root, 'sfdx-project.json'), 'utf8'));
  const path = resolve(root, first!);
  if (!path.startsWith(root + sep)) throw Error('The default package directory is outside this project.');
  return join(path, 'main', 'default');
}

/** Atomic replace inside the project: unique temp file, then rename over the destination. */
async function writeConfined(root: string, target: string, content: Buffer) {
  const parent = dirname(target);
  await mkdir(parent, { recursive: true });
  const real = await realpath(parent);
  if (!inside(root, real)) throw Error('The destination folder is outside this project.');
  const staging = join(real, `.${basename(target)}.zcc-sync-${randomUUID()}`);
  try {
    await writeFile(staging, content, { flag: 'wx' });
    await rename(staging, join(real, basename(target)));
  } finally {
    await rm(staging, { force: true });
  }
}
