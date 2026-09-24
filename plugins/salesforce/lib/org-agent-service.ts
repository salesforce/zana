import { randomUUID } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { SalesforceDeps, PublicOrgView } from './types.js';
import type { OrgAgent, OrgAgentCatalog, OrgAgentRetrieval, RetrievedOrgAgent } from './org-agent-contract.js';

const LIMIT = 1000;
const SOURCE_LIMIT = 180_000;
const TIMEOUT = 120_000;
const NAME = /^[A-Za-z][A-Za-z0-9_]*(?:#[1-9][0-9]*|\.v[1-9][0-9]*)?$/;
const validName = (value: unknown): value is string => typeof value === 'string' && value.length <= 240 && NAME.test(value);
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function parseAgentCatalog(value: unknown): Pick<OrgAgentCatalog, 'agents' | 'truncated'> {
  if (!Array.isArray(value)) throw Error('Salesforce returned an invalid agent inventory. Refresh to retry.');
  const groups = new Map<string, OrgAgent>();
  for (const item of value.slice(0, LIMIT)) {
    const row = record(item);
    if (!validName(row.fullName)) continue;
    // Bundle versions are source versions, not necessarily BotVersion numbers.
    const match = /^(.*?)(?:_v|\.v|#)([1-9][0-9]*)$/.exec(row.fullName);
    const name = match?.[1] ?? row.fullName;
    const agent = groups.get(name) ?? { name, versions: [] };
    if (!agent.versions.some(version => version.fullName === row.fullName)) agent.versions.push({
      fullName: row.fullName,
      version: match ? Number(match[2]) : null,
      modifiedAt: typeof row.lastModifiedDate === 'string' ? row.lastModifiedDate.slice(0, 40) : null,
    });
    groups.set(name, agent);
  }
  const agents = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const agent of agents) agent.versions.sort((a, b) => (b.version ?? 0) - (a.version ?? 0));
  return { agents, truncated: value.length > LIMIT };
}

function cliResult(result: Awaited<ReturnType<SalesforceDeps['execSf']>>) {
  let payload: Record<string, unknown>;
  try { payload = record(JSON.parse(result.stdout)); }
  catch { throw Error('Salesforce CLI returned incomplete output. Check the CLI connection and retry.'); }
  if (result.code !== 0 || payload.status !== 0) {
    throw Error(typeof payload.message === 'string' ? payload.message.slice(0, 400) : 'Salesforce could not retrieve the agent metadata. Check your org access and CLI version.');
  }
  return payload.result;
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  let entries = 0;
  const walk = (directory: string, depth: number) => {
    if (depth > 10) throw Error('The retrieved bundle has too many nested folders.');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++entries > 100) throw Error('The retrieved bundle contains too many files.');
      if (entry.isSymbolicLink()) throw Error('The retrieved bundle contains a symbolic link.');
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path, depth + 1);
      else if (entry.isFile() && /(?:\.agent|\.bundle-meta\.xml)$/.test(entry.name)) files.push(path);
    }
  };
  walk(root, 0);
  if (files.filter(path => path.endsWith('.agent')).length !== 1) throw Error('This version has no single editable Agent Script. Retrieve an authoring bundle created in the new Agentforce Builder.');
  return files;
}

function safeDirectory(root: string, parts: string[]): string {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    try { mkdirSync(path, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    if (lstatSync(path).isSymbolicLink() || !statSync(path).isDirectory() || !realpathSync(path).startsWith(root + sep)) {
      throw Error('The local agent folder must stay inside this project and cannot be a symbolic link.');
    }
  }
  return path;
}

/** Reads org metadata into an isolated DX project, then imports a bounded local copy. */
export class OrgAgentService {
  private readonly jobs = new Map<string, { root: string; at: number; controller: AbortController; result: OrgAgentRetrieval }>();
  private listing = 0;
  private disposed = false;
  constructor(private readonly deps: { execSf: SalesforceDeps['execSf']; connect(): Promise<PublicOrgView> }) {}

  dispose() { this.disposed = true; for (const job of this.jobs.values()) job.controller.abort(); this.jobs.clear(); }

  async list(): Promise<OrgAgentCatalog> {
    if (this.disposed || this.listing >= 2) throw Error('Agent discovery is busy. Try again shortly.');
    this.listing++;
    try {
      const org = await this.deps.connect();
      const result = await this.deps.execSf(['org', 'list', 'metadata', '--metadata-type', 'AiAuthoringBundle', '--target-org', org.alias, '--json'], { timeoutMs: 30_000 });
      return { org: { alias: org.alias, orgId: org.orgId }, ...parseAgentCatalog(cliResult(result)) };
    } finally { this.listing--; }
  }

  async start(root: string, input: unknown): Promise<{ jobId: string }> {
    const args = record(input);
    if (!validName(args.fullName)) throw Error('Choose an agent version from the org list.');
    const canonicalRoot = realpathSync(root);
    if (!statSync(canonicalRoot).isDirectory()) throw Error('Open a local project before retrieving an agent.');
    const org = await this.deps.connect();
    if (args.orgId !== org.orgId) throw Error('The selected org changed. Refresh the agent list before retrieving.');
    if (!/^[A-Za-z0-9]{15,18}$/.test(org.orgId)) throw Error('Salesforce returned an invalid org identity.');
    if (this.disposed) throw Error('The Salesforce plugin is restarting. Retry shortly.');
    for (const [id, job] of this.jobs) if (job.result.state !== 'running' && Date.now() - job.at > 600_000) this.jobs.delete(id);
    if ([...this.jobs.values()].filter(job => job.result.state === 'running').length >= 2 || [...this.jobs.values()].some(job => job.root === canonicalRoot && job.result.state === 'running')) throw Error('An agent retrieval is already running. Wait for it to finish.');
    if (this.jobs.size >= 12) {
      const finished = [...this.jobs].find(([, job]) => job.result.state !== 'running');
      if (finished) this.jobs.delete(finished[0]);
    }
    const jobId = randomUUID();
    const job = { root: canonicalRoot, at: Date.now(), controller: new AbortController(), result: { state: 'running' } as OrgAgentRetrieval };
    this.jobs.set(jobId, job);
    void this.retrieve(canonicalRoot, org, args.fullName, job.controller.signal).then(
      file => { job.result = { state: 'done', file }; },
      error => { job.result = { state: 'failed', error: error instanceof Error ? error.message : 'Could not retrieve this agent.' }; },
    );
    return { jobId };
  }

  status(root: string, jobId: string): OrgAgentRetrieval {
    const job = this.jobs.get(jobId);
    if (!job || job.root !== realpathSync(root)) throw Error('This agent retrieval is unavailable in the current project.');
    return job.result;
  }

  cancel(root: string, jobId: string) {
    this.status(root, jobId);
    this.jobs.get(jobId)!.controller.abort();
  }

  private async retrieve(root: string, org: PublicOrgView, fullName: string, signal: AbortSignal): Promise<RetrievedOrgAgent> {
    const directory = join(root, 'agentforce', org.orgId, fullName);
    const local = () => {
      try { lstatSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      safeDirectory(root, ['agentforce', org.orgId, fullName]);
      const source = sourceFiles(directory).find(path => path.endsWith('.agent'))!;
      return { path: relative(root, source).split(sep).join('/'), orgId: org.orgId, fullName, existing: true };
    };
    // Existing local source wins, including unsaved editor recovery on reopening.
    const existing = local();
    if (existing) return existing;
    const temporary = mkdtempSync(join(tmpdir(), 'zcc-sf-agent-'));
    let staging: string | undefined;
    try {
      mkdirSync(join(temporary, 'force-app'));
      writeFileSync(join(temporary, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }] }), { mode: 0o600 });
      const result = cliResult(await this.deps.execSf(['project', 'retrieve', 'start', '--metadata', `AiAuthoringBundle:${fullName}`, '--target-org', org.alias, '--json', '--wait', '2'], { cwd: temporary, timeoutMs: TIMEOUT, signal }));
      signal.throwIfAborted();
      if (record(result).success === false || record(result).done === false) throw Error('Salesforce did not complete the retrieval. Retry after it finishes.');
      const files = sourceFiles(join(temporary, 'force-app'));
      const contents = files.map(path => {
        if (statSync(path).size > SOURCE_LIMIT) throw Error('This agent source exceeds the editor size limit.');
        return { name: basename(path), content: readFileSync(path, 'utf8') };
      });
      if (contents.length > 2 || new Set(contents.map(file => file.name)).size !== contents.length) throw Error('Salesforce returned an ambiguous authoring bundle.');
      const parent = safeDirectory(root, ['agentforce', org.orgId]);
      staging = mkdtempSync(join(parent, '.import-'));
      for (const file of contents) writeFileSync(join(staging, file.name), file.content, { mode: 0o600, flag: 'wx' });
      signal.throwIfAborted();
      const appeared = local();
      if (appeared) return appeared;
      renameSync(staging, directory);
      staging = undefined;
      return { path: relative(root, join(directory, contents.find(file => file.name.endsWith('.agent'))!.name)).split(sep).join('/'), orgId: org.orgId, fullName, existing: false };
    } finally {
      rmSync(temporary, { recursive: true, force: true });
      if (staging) rmSync(staging, { recursive: true, force: true });
    }
  }
}
