import type { Project } from '@zana-ai/zcc-domain/product';
import type { ProjectMetadataRequest, ProjectMetadataResult } from '@zana-ai/zcc-contracts/project-metadata-records';
import { localMetadataProjects } from './project-metadata.js';

type RecordValue = { id: string; projectId: string; source?: 'global' | { projectId: string } };
export interface MetadataPersistence<T> {
  load(): Promise<T[]>;
  read?(record: T): Promise<T>;
  save(record: T, definitionPatch?: Partial<T>): Promise<void>;
  remove(record: T): Promise<void>;
  localProjects(): Project[];
}

/** Original-owner persistence for the desktop's legacy record managers. The
 * primary's global records stay instance-scoped; foreign project records use
 * the private product-runtime bridge. A failed refresh preserves the last
 * snapshot, while every mutation still requires its actual owner to respond.
 * The manager serializes load/read-modify-write, never publishes before save.
 */
export class ProjectRecordStore<T extends RecordValue> implements MetadataPersistence<T> {
  private snapshots = new Map<string, T[]>();
  private revisions = new Map<string, Map<string, string>>();
  private inFlight = new Map<string, Promise<ProjectMetadataResult>>();
  private refreshCursor = 0;
  constructor(private readonly deps: {
    kind: ProjectMetadataRequest['kind'];
    projects(): Project[];
    primaryHostId(): string | undefined;
    request(request: ProjectMetadataRequest): Promise<ProjectMetadataResult>;
    validate(raw: unknown): T | { error: string };
    local: { list(projects: Project[]): T[]; read?(record: T, projects: Project[]): T; save(record: T, projects: Project[], definitionPatch?: Partial<T>): void; remove(id: string, projects: Project[]): boolean };
    log(projectId: string, error: unknown): void;
  }) {}

  localProjects(): Project[] { return localMetadataProjects(this.deps.projects(), this.deps.primaryHostId()); }

  async load(): Promise<T[]> {
    const projects = this.deps.projects();
    const local = this.localProjects();
    const localIds = new Set(local.map(p => p.id));
    const foreign = projects.filter(p => !localIds.has(p.id));
    const foreignIds = new Set(foreign.map(p => p.id));
    for (const id of this.snapshots.keys()) if (!foreignIds.has(id)) { this.snapshots.delete(id); this.revisions.delete(id); }
    const records = this.deps.local.list(local);
    // One slow owner must not multiply startup latency by the number of
    // projects. Bound the whole refresh and keep at most four reads outstanding,
    // including requests whose result arrives after this refresh's deadline.
    const deadline = Date.now() + 15_000;
    const start = foreign.length ? this.refreshCursor % foreign.length : 0;
    const ordered = [...foreign.slice(start), ...foreign.slice(0, start)];
    let cursor = 0;
    const refresh = async () => {
      while (cursor < ordered.length && Date.now() < deadline) {
        if (this.inFlight.size >= 4) return;
        const project = ordered[cursor++];
        if (this.inFlight.has(project.id)) continue;
        this.refreshCursor = (start + cursor) % foreign.length;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const request = Promise.resolve().then(() => this.deps.request({ action: 'list', projectId: project.id, kind: this.deps.kind }));
        this.inFlight.set(project.id, request);
        const release = () => { if (this.inFlight.get(project.id) === request) this.inFlight.delete(project.id); };
        void request.then(release, release);
        try {
          const result = await Promise.race([request, new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Metadata refresh deadline exceeded')), Math.max(1, deadline - Date.now()));
          })]);
          if (result.projectId !== project.id || result.kind !== this.deps.kind) throw new Error('Metadata response scope mismatch');
          const revisions = new Map<string, string>();
          const snapshot = result.records.map(record => {
            const value = this.deps.validate(JSON.parse(record.content));
            if ('error' in value) throw new Error(value.error);
            if (value.id !== record.id || value.projectId !== project.id || revisions.has(value.id)) throw new Error('Metadata record identity mismatch');
            revisions.set(value.id, record.sha256);
            return { ...value, source: { projectId: project.id } };
          });
          this.snapshots.set(project.id, snapshot);
          this.revisions.set(project.id, revisions);
        } catch (error) { this.deps.log(project.id, error); }
        finally { if (timer) clearTimeout(timer); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, foreign.length) }, refresh));
    for (const project of foreign) records.push(...(this.snapshots.get(project.id) ?? []));
    const identities = new Set<string>();
    for (const record of records) {
      if (identities.has(record.id)) throw new Error(`Duplicate metadata record identity: ${record.id}`);
      identities.add(record.id);
    }
    return records;
  }

  private foreignProject(record: T): Project | null {
    if (!record.source || record.source === 'global') return null;
    if (record.source.projectId !== record.projectId) throw new Error('Metadata record scope mismatch');
    const project = this.deps.projects().find(p => p.id === record.projectId);
    if (!project) throw new Error('Unknown metadata project');
    return this.localProjects().some(p => p.id === project.id) ? null : project;
  }

  /** Explicit reads require the owner to respond; never return a stale snapshot. */
  async read(record: T): Promise<T> {
    const project = this.foreignProject(record);
    if (!project) {
      if (this.deps.local.read) return this.deps.local.read(record, this.localProjects());
      const found = this.deps.local.list(this.localProjects()).find(value => value.id === record.id);
      if (!found) throw new Error(`Metadata record not found: ${record.id}`);
      return found;
    }
    const result = await this.deps.request({ action: 'list', projectId: project.id, kind: this.deps.kind });
    if (result.projectId !== project.id || result.kind !== this.deps.kind) throw new Error('Metadata response scope mismatch');
    const found = result.records.find(value => value.id === record.id);
    if (!found) throw new Error(`Metadata record not found: ${record.id}`);
    const value = this.deps.validate(JSON.parse(found.content));
    if ('error' in value) throw new Error(value.error);
    if (value.id !== record.id || value.projectId !== project.id) throw new Error('Metadata record identity mismatch');
    const revisions = this.revisions.get(project.id) ?? new Map<string, string>();
    revisions.set(record.id, found.sha256); this.revisions.set(project.id, revisions);
    return { ...value, source: { projectId: project.id } };
  }

  async save(record: T, definitionPatch?: Partial<T>): Promise<void> {
    const project = this.foreignProject(record);
    if (!project) { this.deps.local.save(record, this.localProjects(), definitionPatch); return; }
    const { source: _source, ...value } = record;
    const result = await this.deps.request({ action: 'write', projectId: project.id, kind: this.deps.kind,
      id: record.id, content: JSON.stringify(value, null, 2), expectedSha256: this.revisions.get(project.id)?.get(record.id) ?? null });
    if (result.projectId !== project.id || result.kind !== this.deps.kind || result.records.length !== 1 || result.records[0].id !== record.id) throw new Error('Metadata write response mismatch');
    const revisions = this.revisions.get(project.id) ?? new Map<string, string>();
    revisions.set(record.id, result.records[0].sha256); this.revisions.set(project.id, revisions);
    this.snapshots.set(project.id, [...(this.snapshots.get(project.id) ?? []).filter(r => r.id !== record.id), record]);
  }

  async remove(record: T): Promise<void> {
    const project = this.foreignProject(record);
    if (!project) {
      if (!this.deps.local.remove(record.id, this.localProjects())) throw new Error('Metadata record could not be removed');
      return;
    }
    const revision = this.revisions.get(project.id)?.get(record.id);
    if (!revision) throw new Error('Metadata revision is unavailable; refresh before removing this record');
    await this.deps.request({ action: 'remove', projectId: project.id, kind: this.deps.kind, id: record.id, expectedSha256: revision });
    this.revisions.get(project.id)?.delete(record.id);
    this.snapshots.set(project.id, (this.snapshots.get(project.id) ?? []).filter(r => r.id !== record.id));
  }
}
