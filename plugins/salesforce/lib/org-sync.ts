import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { diffStats, lineDiff } from './line-diff.js';
import {
  SCOPE_TYPES, SYNC_FETCH_MAX, SYNC_TYPES,
  type SyncCheck, type SyncComponent, type SyncDiff, type SyncJob, type SyncPlanFile, type SyncScope, type SyncState, type SyncType,
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

/** Where each type lives inside a package directory, and whether a component is a folder. */
const LAYOUT: Record<SyncType, { folder: string; bundle: boolean; ext?: string }> = {
  AiAuthoringBundle: { folder: 'aiAuthoringBundles', bundle: true },
  ApexClass: { folder: 'classes', bundle: false, ext: '.cls' },
  ApexTrigger: { folder: 'triggers', bundle: false, ext: '.trigger' },
  LightningComponentBundle: { folder: 'lwc', bundle: true },
};
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,254}$/;
const VERSIONED = /^(.*?)_([1-9][0-9]*)$/;
const BATCH = 1000;
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
type PlanEntry = SyncPlanFile & { source: string; target: string; localSha: string | null; orgSha: string };
type Job = {
  root: string;
  org: PublicOrgView;
  at: number;
  controller: AbortController;
  temporary?: string;
  plan?: PlanEntry[];
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

/** Agent bundle versions are `<Agent>_<n>`; the bare name is the local working copy. */
export function agentVersion(name: string): { base: string; version: number } {
  const match = name.match(VERSIONED);
  return match ? { base: match[1]!, version: Number(match[2]) } : { base: name, version: 0 };
}

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

export function manifest(keys: string[], apiVersion: string): string {
  const byType = new Map<string, string[]>();
  for (const key of keys) {
    const [type, name] = key.split(':') as [string, string];
    byType.set(type, [...(byType.get(type) ?? []), name]);
  }
  const types = [...byType].map(([type, names]) => `  <types>\n${names.map(name => `    <members>${name}</members>`).join('\n')}\n    <name>${type}</name>\n  </types>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${types}\n  <version>${apiVersion}</version>\n</Package>\n`;
}

function cliResult(result: Awaited<ReturnType<SalesforceDeps['execSf']>>, fallback: string): unknown {
  let payload: Record<string, unknown>;
  try { payload = record(JSON.parse(result.stdout)); } catch { throw Error('Salesforce CLI returned incomplete output. Check the CLI connection and retry.'); }
  if (result.code !== 0 || payload.status !== 0) throw Error(typeof payload.message === 'string' ? payload.message.slice(0, 400) : fallback);
  return payload.result;
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
    const types = SCOPE_TYPES[scope];
    const org = await this.deps.connect();
    const [local, listed] = await Promise.all([this.localIndex(root, types), Promise.all(types.map(type => this.list(type, org, signal)))]);
    const components: SyncComponent[] = [];
    const counts: SyncCheck['counts'] = { changed: 0, conflict: 0, unknown: 0, new: 0, deleted: 0, current: 0 };
    const dates = new Map<string, string | null>();
    const add = (type: SyncType, row: OrgRow, state: SyncState, latest = false) => {
      counts[state]++;
      components.push({ key: `${type}:${row.name}`, type, fullName: row.name, state, modifiedAt: row.at, modifiedBy: row.by, ...(latest ? { latest } : {}) });
    };
    for (const [index, type] of types.entries()) {
      const rows = listed[index]!;
      const marks = await this.marks(org.orgId, type);
      const here = local.get(type)!;
      const inOrg = new Set<string>();
      const newest = type === 'AiAuthoringBundle' ? newestVersions(rows, here) : new Set<string>();
      for (const row of rows) {
        inOrg.add(row.name);
        dates.set(`${type}:${row.name}`, row.at);
        const mark = marks[row.name];
        if (!here.has(row.name)) add(type, row, 'new', newest.has(row.name));
        else if (!mark) add(type, row, 'unknown');
        else if (mark.at && row.at && Date.parse(row.at) <= Date.parse(mark.at)) counts.current++;
        else add(type, row, await locallyChanged(root, mark) ? 'conflict' : 'changed');
      }
      for (const name of Object.keys(marks)) if (!inOrg.has(name) && here.has(name)) add(type, { name, at: null, by: null }, 'deleted');
    }
    const key = `${root}\0${org.orgId}`;
    this.checks.delete(key);
    this.checks.set(key, dates);
    while (this.checks.size > CHECK_CACHE) this.checks.delete(this.checks.keys().next().value!);
    const rank: Record<SyncState, number> = { conflict: 0, changed: 1, new: 2, unknown: 3, deleted: 4 };
    components.sort((a, b) => rank[a.state] - rank[b.state] || Number(b.latest ?? false) - Number(a.latest ?? false) || (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? '') || a.key.localeCompare(b.key));
    return { org: { alias: org.alias, orgId: org.orgId }, scope, checkedAt: (this.deps.now ?? Date.now)(), components: components.slice(0, RESULT_ROWS), counts, truncated: components.length > RESULT_ROWS };
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
    const job: Job = { root, org, at: (this.deps.now ?? Date.now)(), controller: new AbortController(), dates: new Map(this.checks.get(`${root}\0${org.orgId}`) ?? []), result: { state: 'running', done: 0, total: keys.length } };
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

  /** Writes safe files and the conflicts the operator chose to replace, then records what was fetched. */
  async apply(projectRoot: string, jobId: string, input: unknown): Promise<SyncJob> {
    const job = await this.job(projectRoot, jobId);
    if (job.result.state !== 'ready' || !job.plan) throw Error('This fetch has no plan to apply.');
    const chosen = record(input).take;
    const take = new Set(Array.isArray(chosen) ? chosen.filter((path): path is string => typeof path === 'string') : []);
    const plan = job.plan;
    job.plan = undefined;
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
    } finally {
      await this.clean(job);
    }
    job.result = { state: 'applied', written, kept, skipped };
    return job.result;
  }

  async cancel(projectRoot: string, jobId: string) {
    await this.job(projectRoot, jobId);
    await this.drop(jobId);
  }

  private async fetch(job: Job, keys: string[]): Promise<SyncJob> {
    const { signal } = job.controller;
    const temporary = job.temporary = await mkdtemp(join(tmpdir(), 'zcc-sf-sync-'));
    let version: unknown;
    try { version = record(JSON.parse(await readFile(join(job.root, 'sfdx-project.json'), 'utf8'))).sourceApiVersion; } catch { /* the org's version */ }
    const apiVersion = typeof version === 'string' && /^[0-9]{2,3}\.0$/.test(version) ? version : job.org.apiVersion;
    await mkdir(join(temporary, 'force-app'));
    await writeFile(join(temporary, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: apiVersion }), { mode: 0o600 });
    for (let index = 0; index < keys.length; index += BATCH) {
      const batch = keys.slice(index, index + BATCH);
      await writeFile(join(temporary, 'package.xml'), manifest(batch, apiVersion), { mode: 0o600 });
      signal.throwIfAborted();
      const result = record(cliResult(await this.deps.execSf(
        ['project', 'retrieve', 'start', '--manifest', 'package.xml', '--target-org', job.org.alias, '--json', '--wait', '15'],
        { cwd: temporary, timeoutMs: RETRIEVE_TIMEOUT, signal },
      ), 'Salesforce could not retrieve the metadata. Check your org access and retry.'));
      signal.throwIfAborted();
      if (result.success === false || result.done === false) throw Error('Salesforce did not complete the retrieval. Retry after it finishes.');
      for (const row of Array.isArray(result.fileProperties) ? result.fileProperties.map(record) : []) {
        const key = `${row.type}:${String(row.fullName ?? '').split('/')[0]}`;
        const at = iso(row.lastModifiedDate);
        if (at && !job.dates.get(key)) job.dates.set(key, at);
      }
      if (job.result.state === 'running') job.result = { ...job.result, done: Math.min(keys.length, index + batch.length) };
    }
    const plan = await this.plan(job, new Set(keys), join(temporary, 'force-app', 'main', 'default'));
    signal.throwIfAborted();
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

  private async plan(job: Job, keys: Set<string>, retrieved: string): Promise<PlanEntry[]> {
    const types = [...new Set([...keys].map(key => key.split(':')[0] as SyncType))];
    const local = await this.localIndex(job.root, types);
    const target = await defaultFolder(job.root);
    const plan: PlanEntry[] = [];
    let measured = 0;
    for (const type of types) {
      const marks = await this.marks(job.org.orgId, type);
      const folder = join(retrieved, LAYOUT[type].folder);
      const files = (await listFiles(folder)).map(source => ({ source, rest: posix(folder, source) }));
      const aliases = type === 'AiAuthoringBundle' ? bareVersions(files.map(file => componentName(type, file.rest)), keys) : new Map<string, string>();
      for (const { source, rest: retrieved } of files) {
        let rest = retrieved;
        let name = componentName(type, rest);
        const alias = name ? aliases.get(name) : undefined;
        if (name && alias) { rest = renameBundle(rest, name, alias); name = alias; }
        const key = `${type}:${name}`;
        if (!name || !keys.has(key)) continue;
        const destination = resolve(local.get(type)!.get(name)?.folder ?? join(target, LAYOUT[type].folder), rest);
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

  private async list(type: SyncType, org: PublicOrgView, signal?: AbortSignal): Promise<OrgRow[]> {
    if (type === 'AiAuthoringBundle') {
      const rows = cliResult(await this.deps.execSf(['org', 'list', 'metadata', '--metadata-type', type, '--target-org', org.alias, '--json'], { timeoutMs: 60_000, signal }), 'Salesforce could not list agents. Check your org access and retry.');
      return (Array.isArray(rows) ? rows : []).slice(0, LIST_ROWS).map(record)
        .filter(row => !row.namespacePrefix && row.manageableState !== 'installed' && typeof row.fullName === 'string' && NAME.test(row.fullName))
        .map(row => ({ name: String(row.fullName), at: iso(row.lastModifiedDate), by: typeof row.lastModifiedByName === 'string' ? row.lastModifiedByName : null }));
    }
    // SOQL takes seconds where listMetadata takes a minute on orgs with many managed classes.
    const field = type === 'LightningComponentBundle' ? 'DeveloperName' : 'Name';
    let page = await this.deps.query(`SELECT ${field}, LastModifiedDate, LastModifiedBy.Name FROM ${type} WHERE NamespacePrefix = null ORDER BY ${field}`, { tooling: type === 'LightningComponentBundle', signal });
    const rows = [...(page.records ?? [])];
    while (!page.done && page.nextRecordsUrl && rows.length < LIST_ROWS) {
      page = await this.deps.queryMore(page.nextRecordsUrl, { signal });
      rows.push(...(page.records ?? []));
    }
    return rows.slice(0, LIST_ROWS).filter(row => typeof row[field] === 'string' && NAME.test(row[field] as string)).map(row => {
      const by = record(row.LastModifiedBy).Name;
      return { name: row[field] as string, at: iso(row.LastModifiedDate), by: typeof by === 'string' ? by : null };
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
    const temporary = job.temporary;
    job.temporary = undefined;
    job.plan = undefined;
    if (temporary) await rm(temporary, { recursive: true, force: true });
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

async function defaultFolder(root: string): Promise<string> {
  const [first] = packageDirectories(await readFile(join(root, 'sfdx-project.json'), 'utf8'));
  const path = resolve(root, first!);
  if (!path.startsWith(root + sep)) throw Error('The default package directory is outside this project.');
  return join(path, 'main', 'default');
}

async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (path: string, depth: number) => {
    if (depth > 8) return;
    let children;
    try { children = await readdir(path, { withFileTypes: true }); } catch { return; }
    for (const child of children) {
      const next = join(path, child.name);
      if (child.isDirectory()) await walk(next, depth + 1);
      else if (child.isFile()) out.push(next);
    }
  };
  await walk(dir, 0);
  return out;
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
