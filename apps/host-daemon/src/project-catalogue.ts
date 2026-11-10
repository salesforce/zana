import { promises as fs } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MACHINE_PROJECT_LIMIT, machineProjectSchema, machineProjectRegisterSchema, type MachineProject } from '@zana-ai/zcc-contracts/machine-projects';
import { inspectDirectories } from './inspect-directories.js';
import { resolveZccDataDir } from './host-config.js';

/** Older service units have no source variable. Recognize our installed layout
 * so upgrading their daemon does not require reinstalling the service. */
export function resolveProjectCatalogueSource(dataDir: string, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  return env.ZCC_PROJECT_CATALOGUE_DATA_DIR?.trim() ||
    (dirname(resolve(dataDir)) === resolve(home, '.zcc-machines') ? join(home, '.zcc') : resolveZccDataDir(env, home));
}

const MAX_BYTES = 8 * 1024 * 1024;
const fileSchema = z.object({ version: z.literal(1), projects: z.array(machineProjectSchema).max(MACHINE_PROJECT_LIMIT) }).strict();
// One writer lane per daemon-owned file, including independently constructed runtimes.
const lanes = new Map<string, Promise<unknown>>();
async function serialized<T>(file: string, task: () => Promise<T>): Promise<T> {
  const pending = (lanes.get(file) ?? Promise.resolve()).then(task, task);
  lanes.set(file, pending);
  try { return await pending; } finally { if (lanes.get(file) === pending) lanes.delete(file); }
}
async function readBounded(file: string): Promise<unknown> {
  const handle = await fs.open(file, 'r');
  try {
    if ((await handle.stat()).size > MAX_BYTES) throw new Error('Project catalogue exceeds its size limit');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > MAX_BYTES) throw new Error('Project catalogue exceeds its size limit');
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally { await handle.close(); }
}

/** This registry is machine-owned; product histories and display preferences stay on the server. */
export class ProjectCatalogue {
  readonly file: string;
  private sourceSignature = '';
  private lastRevision = '';
  private stopped = false;
  private refreshing?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  constructor(readonly dataDir: string, private readonly sourceDataDir: string | undefined,
    private readonly changed: (revision: string) => void = () => {}) {
    this.file = join(resolve(dataDir), 'machine-projects.json');
  }
  private async read(): Promise<MachineProject[]> {
    try { return fileSchema.parse(await readBounded(this.file)).projects; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  }
  private async write(projects: MachineProject[]): Promise<void> {
    const bytes = JSON.stringify(fileSchema.parse({ version: 1, projects }));
    if (Buffer.byteLength(bytes) > MAX_BYTES) throw new Error('Project catalogue exceeds its size limit');
    await fs.mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.tmp-${randomUUID()}`;
    try {
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await fs.rename(temp, this.file);
    } finally { await fs.rm(temp, { force: true }); }
  }
  async register(inputs: Array<{ path: string; name?: string }>): Promise<MachineProject[]> {
    if (!inputs.length || inputs.length > 100) throw new Error('Register between 1 and 100 projects');
    const parsed = inputs.map(input => machineProjectRegisterSchema.parse(input));
    const inspected = await inspectDirectories(parsed.map(input => input.path));
    const canonical = inspected.directories.map(row => {
      if (row.status !== 'ready' || !row.path) throw new Error(`Project folder is unavailable: ${row.requestedPath}`);
      return row.path;
    });
    const result = await serialized(this.file, async () => {
      const projects = await this.read(), registered: MachineProject[] = [];
      let dirty = false;
      for (let i = 0; i < parsed.length; i++) {
        const path = canonical[i];
        let project = projects.find(row => row.path === path);
        if (!project) {
          if (projects.length >= MACHINE_PROJECT_LIMIT) throw new Error('Machine project catalogue is full');
          project = machineProjectSchema.parse({ id: randomUUID(), path, name: parsed[i].name ?? (basename(path) || path) });
          projects.push(project); dirty = true;
        }
        registered.push(project);
      }
      if (dirty) await this.write(projects);
      return registered;
    });
    await this.publishRevision();
    return result;
  }
  private async importLocalProjects(): Promise<void> {
    if (!this.sourceDataDir) return;
    const source = join(this.sourceDataDir, 'projects.json');
    let signature: string;
    try { const stat = await fs.stat(source); signature = `${stat.ino}:${stat.size}:${stat.mtimeMs}`; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (signature === this.sourceSignature) return;
    const raw = await readBounded(source);
    const candidates = Array.isArray(raw) ? raw : (raw as { projects?: unknown })?.projects;
    if (!Array.isArray(candidates) || candidates.length > MACHINE_PROJECT_LIMIT) throw new Error('Invalid or oversized local project catalogue');
    const inputs: Array<{ path: string; name?: string }> = [];
    for (const row of candidates) {
      if (!row || typeof row !== 'object' || row.remote || row.hostId || row.quickAgent) continue;
      const parsed = machineProjectRegisterSchema.safeParse({ path: row.path, name: row.name });
      if (parsed.success) inputs.push(parsed.data);
    }
    const canonical: Array<{ path: string; name: string }> = [];
    for (let offset = 0; offset < inputs.length; offset += 100) {
      const chunk = inputs.slice(offset, offset + 100);
      const inspected = await inspectDirectories(chunk.map(row => row.path));
      inspected.directories.forEach((row, index) => {
        if (row.status === 'ready' && row.path) canonical.push({ path: row.path, name: chunk[index].name ?? basename(row.path) });
      });
    }
    await serialized(this.file, async () => {
      const projects = await this.read();
      let dirty = false;
      for (const input of canonical) {
        const project = projects.find(project => project.path === input.path);
        if (project) {
          if (project.name !== input.name) { project.name = input.name; dirty = true; }
        } else {
          if (projects.length >= MACHINE_PROJECT_LIMIT) throw new Error('Machine project catalogue is full');
          projects.push(machineProjectSchema.parse({ id: randomUUID(), ...input })); dirty = true;
        }
      }
      if (dirty) await this.write(projects);
    });
    this.sourceSignature = signature;
  }
  private async revision(projects: MachineProject[]): Promise<string> {
    const statuses = [];
    for (let offset = 0; offset < projects.length; offset += 100) {
      statuses.push(...(await inspectDirectories(projects.slice(offset, offset + 100).map(row => row.path))).directories.map(row => row.status));
    }
    return createHash('sha256').update(JSON.stringify([projects, statuses])).digest('hex');
  }
  private async publishRevision(): Promise<string> {
    const revision = await this.revision(await this.read());
    if (revision !== this.lastRevision) { this.lastRevision = revision; if (!this.stopped) this.changed(revision); }
    return revision;
  }
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return this.refreshing ??= (async () => { await this.importLocalProjects(); await this.publishRevision(); })()
      .finally(() => { this.refreshing = undefined; });
  }
  async page(offset: number, limit: number) {
    await this.refresh();
    const projects = await this.read();
    return { revision: await this.revision(projects), projects: projects.slice(offset, offset + limit),
      nextOffset: offset + limit < projects.length ? offset + limit : null };
  }
  start(): void {
    if (this.timer || this.stopped) return;
    const refresh = () => { void this.refresh().catch(() => { /* Retain the last good registry; retry on the next tick. */ }); };
    refresh(); this.timer = setInterval(refresh, 10_000); this.timer.unref();
  }
  async close(): Promise<void> { this.stopped = true; clearInterval(this.timer); await this.refreshing?.catch(() => {}); }
}
