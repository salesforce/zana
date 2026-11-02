import type { PluginDatabase } from '@zana-ai/zcc-plugin-sdk/server';
import { assertRegisteredProject, type ProjectLister } from './project-guard.js';
import { DesignDocError } from './store.js';

/**
 * Local-only project bookkeeping, kept out of the append-only migration book and
 * out of everything that syncs or hashes:
 *  - `dd_project_refs` remembers the last name/tag of every registered project so a
 *    doc of a deleted project shows "<name> (project removed)", not "Unknown project";
 *  - `dd_project_aliases` maps a foreign project id (carried by a doc received from a
 *    peer, held in `sync_doc_references.project_json`) to a local project. `docs.project_id`
 *    is never written for a mapping.
 * Both tables are created lazily; if that fails the feature degrades to "Unknown project".
 */
export interface ProjectInfo { id: string; name?: string; tag?: string }

export interface UnassignedForeignProject {
  foreignProjectId: string;
  docCount: number;
  sampleTitles: string[];
  /** A registered project matching the stored tag, then name. Never applied automatically. */
  suggestion: { projectId: string; name: string; basis: 'tag' | 'name' } | null;
}

export interface ProjectMapping {
  foreignProjectId: string;
  localProjectId: string;
  docCount: number;
  sampleTitles: string[];
  /** False when the local project is no longer registered (the mapping is dead and pruned on the next project fetch). */
  localRegistered: boolean;
}

const MAX_MAPPINGS = 200;
const MAX_ID_LENGTH = 512;
const MAX_UNASSIGNED = 200;
const SAMPLE_TITLES = 3;
const REMOVED_SUFFIX = ' (project removed)';

/** SQL fragments over `docs d`; shared with the store's list scoping. */
export const FOREIGN_REF_EXISTS = `EXISTS (SELECT 1 FROM sync_doc_references r WHERE r.doc_id = d.id AND r.project_json <> 'null')`;
export const MAPPED_TO_ANY = `EXISTS (SELECT 1 FROM sync_doc_references r JOIN dd_project_aliases a
  ON a.foreign_project_id = json_extract(r.project_json, '$') WHERE r.doc_id = d.id)`;
export const MAPPED_TO_PROJECT = `EXISTS (SELECT 1 FROM sync_doc_references r JOIN dd_project_aliases a
  ON a.foreign_project_id = json_extract(r.project_json, '$') WHERE r.doc_id = d.id AND a.local_project_id = ?)`;

function cleanId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID_LENGTH) {
    throw new DesignDocError('invalid', `${label} must be a non-empty string of at most ${MAX_ID_LENGTH} characters`);
  }
  return value;
}

export class DesignDocProjectRefs {
  private tables = false;
  private readonly now: () => number;

  constructor(private readonly db: PluginDatabase, options: { now?: () => number; onError?: (error: unknown) => void } = {}) {
    this.now = options.now ?? Date.now;
    this.ensure(options.onError);
  }

  /** Whether the lazy tables exist. Re-tried on demand so a restore that dropped them recovers. */
  get available(): boolean { return this.tables || this.ensure(); }

  private ensure(onError?: (error: unknown) => void): boolean {
    try {
      this.db.runScript(`CREATE TABLE IF NOT EXISTS dd_project_refs (
          project_id TEXT PRIMARY KEY, name TEXT, tag TEXT, last_seen INTEGER);
        CREATE TABLE IF NOT EXISTS dd_project_aliases (
          foreign_project_id TEXT PRIMARY KEY, local_project_id TEXT NOT NULL, updated_at INTEGER);`);
      this.tables = true;
    } catch (error) {
      this.tables = false;
      onError?.(error);
    }
    return this.tables;
  }

  /**
   * Called after every successful project-list fetch: keeps stored names current (renames),
   * drops aliases to projects that are gone, and forgets removed projects no doc refers to.
   * Never throws.
   */
  observe(projects: ProjectInfo[]): void {
    if (!this.available) return;
    try {
      const at = this.now();
      this.db.transaction(() => {
        const upsert = this.db.prepare(`INSERT INTO dd_project_refs (project_id, name, tag, last_seen) VALUES (?, ?, ?, ?)
          ON CONFLICT (project_id) DO UPDATE SET name = excluded.name, tag = excluded.tag, last_seen = excluded.last_seen`);
        for (const project of projects) upsert.run(project.id, project.name || null, project.tag || null, at);
        this.prune(projects.map((project) => project.id));
      });
    } catch {
      this.tables = false; // re-probed on next use
    }
  }

  /** Deletes alias rows whose local project is no longer registered, and unreferenced removed-project rows. */
  private prune(registered: string[]): void {
    const live = new Set(registered);
    const aliases = this.db.prepare('SELECT DISTINCT local_project_id AS id FROM dd_project_aliases').all() as Array<{ id: string }>;
    for (const { id } of aliases) {
      if (!live.has(id)) this.db.prepare('DELETE FROM dd_project_aliases WHERE local_project_id = ?').run(id);
    }
    const refs = this.db.prepare('SELECT project_id AS id FROM dd_project_refs').all() as Array<{ id: string }>;
    for (const { id } of refs) {
      if (live.has(id)) continue;
      // docs-kind: allow Existence probe over every kind; only decides whether a removed-project name is still needed.
      const used = this.db.prepare(`SELECT 1 FROM docs WHERE project_id = ? LIMIT 1`).get(id)
        ?? this.db.prepare('SELECT 1 FROM sync_doc_references WHERE project_json = ? LIMIT 1').get(JSON.stringify(id));
      if (!used) this.db.prepare('DELETE FROM dd_project_refs WHERE project_id = ?').run(id);
    }
  }

  /** "<name> (project removed)" for an id that was once registered, else null (caller shows "Unknown project"). */
  removedLabel(projectId: string | null): string | null {
    if (!projectId || !this.available) return null;
    try {
      const row = this.db.prepare('SELECT name FROM dd_project_refs WHERE project_id = ?').get(projectId) as { name: string | null } | undefined;
      return row?.name ? `${row.name}${REMOVED_SUFFIX}` : null;
    } catch {
      return null;
    }
  }

  /** Labels for every stored project not in `registered`, for the UI to resolve ids of deleted projects. */
  removedProjects(registered: string[]): Array<{ id: string; label: string }> {
    if (!this.available) return [];
    try {
      const live = new Set(registered);
      return (this.db.prepare('SELECT project_id AS id, name FROM dd_project_refs WHERE name IS NOT NULL ORDER BY project_id LIMIT 1000')
        .all() as Array<{ id: string; name: string }>)
        .filter((row) => !live.has(row.id))
        .map((row) => ({ id: row.id, label: `${row.name}${REMOVED_SUFFIX}` }));
    } catch {
      return [];
    }
  }

  private foreignReferenced(foreignId: string): boolean {
    // docs-kind: allow Existence probe by project reference; templates carry none.
    return !!(this.db.prepare(`SELECT 1 FROM docs WHERE kind = 'doc' AND project_id = ? LIMIT 1`).get(foreignId)
      ?? this.db.prepare(`SELECT 1 FROM sync_doc_references r JOIN docs d ON d.id = r.doc_id
        WHERE d.kind = 'doc' AND r.project_json = ? LIMIT 1`).get(JSON.stringify(foreignId)));
  }

  /**
   * Maps a foreign project id to a registered local project. The renderer is untrusted: the local id
   * must be registered (fails closed when the host list is unavailable) and the foreign id must be
   * referenced by at least one doc. Nothing synced changes.
   */
  async mapForeignProject(list: ProjectLister | undefined, foreignId: unknown, localProjectId: unknown): Promise<{ foreignProjectId: string; localProjectId: string }> {
    const foreign = cleanId(foreignId, 'foreignProjectId');
    const local = cleanId(localProjectId, 'localProjectId');
    await assertRegisteredProject(list, local);
    if (!this.available) throw new DesignDocError('invalid', 'project mapping is unavailable');
    this.db.transaction(() => {
      if (!this.foreignReferenced(foreign)) throw new DesignDocError('not_found', `no doc references project ${foreign}`);
      this.db.prepare(`INSERT INTO dd_project_aliases (foreign_project_id, local_project_id, updated_at) VALUES (?, ?, ?)
        ON CONFLICT (foreign_project_id) DO UPDATE SET local_project_id = excluded.local_project_id, updated_at = excluded.updated_at`)
        .run(foreign, local, this.now());
    });
    return { foreignProjectId: foreign, localProjectId: local };
  }

  /** Returns the docs of this foreign id to the unassigned bucket. Idempotent. */
  unmapForeignProject(foreignId: unknown): { removed: boolean } {
    const foreign = cleanId(foreignId, 'foreignProjectId');
    if (!this.available) throw new DesignDocError('invalid', 'project mapping is unavailable');
    const result = this.db.prepare('DELETE FROM dd_project_aliases WHERE foreign_project_id = ?').run(foreign) as { changes?: number };
    return { removed: (result?.changes ?? 0) > 0 };
  }

  /** Existing aliases with their doc counts and sample titles. `registered` is the current host project list. */
  listProjectMappings(registered: ProjectInfo[]): ProjectMapping[] {
    if (!this.available) return [];
    try {
      const live = new Set(registered.map((project) => project.id));
      const rows = this.db.prepare(`SELECT foreign_project_id AS fid, local_project_id AS lid FROM dd_project_aliases
        ORDER BY updated_at DESC, foreign_project_id LIMIT ${MAX_MAPPINGS}`).all() as Array<{ fid: string; lid: string }>;
      return rows.map((row) => {
        const key = JSON.stringify(row.fid);
        // docs-kind: allow Counts and samples are restricted to kind = 'doc'.
        const count = this.db.prepare(`SELECT COUNT(*) AS n FROM docs d JOIN sync_doc_references r ON r.doc_id = d.id
          WHERE d.kind = 'doc' AND d.project_id IS NULL AND r.project_json = ?`).get(key) as { n: number } | undefined;
        // docs-kind: allow Samples are joined to doc-kind rows only.
        const titles = this.db.prepare(`SELECT d.title FROM docs d JOIN sync_doc_references r ON r.doc_id = d.id
          WHERE d.kind = 'doc' AND d.project_id IS NULL AND r.project_json = ? ORDER BY d.updated_at DESC, d.id LIMIT ${SAMPLE_TITLES}`)
          .all(key) as Array<{ title: string }>;
        return { foreignProjectId: row.fid, localProjectId: row.lid, docCount: count?.n ?? 0, sampleTitles: titles.map((t) => t.title), localRegistered: live.has(row.lid) };
      });
    } catch {
      return [];
    }
  }

  /** Foreign project ids with unmapped docs, a few sample titles and a never-applied suggestion. */
  async listUnassignedForeignProjects(list?: ProjectLister): Promise<UnassignedForeignProject[]> {
    if (!this.available) return [];
    // docs-kind: allow Grouped over kind = 'doc' only.
    const rows = this.db.prepare(`SELECT json_extract(r.project_json, '$') AS fid, COUNT(*) AS n
      FROM docs d JOIN sync_doc_references r ON r.doc_id = d.id
      WHERE d.kind = 'doc' AND d.project_id IS NULL AND r.project_json <> 'null' AND NOT ${MAPPED_TO_ANY}
      GROUP BY fid ORDER BY n DESC, fid LIMIT ${MAX_UNASSIGNED}`).all() as Array<{ fid: string | null; n: number }>;
    let registered: Array<ProjectInfo> = [];
    if (list) {
      try { registered = await list(); } catch { registered = []; }
    }
    const out: UnassignedForeignProject[] = [];
    for (const row of rows) {
      if (typeof row.fid !== 'string') continue;
      // docs-kind: allow Samples are joined to doc-kind rows only.
      const titles = this.db.prepare(`SELECT d.title FROM docs d JOIN sync_doc_references r ON r.doc_id = d.id
        WHERE d.kind = 'doc' AND d.project_id IS NULL AND r.project_json = ? ORDER BY d.updated_at DESC, d.id LIMIT ${SAMPLE_TITLES}`)
        .all(JSON.stringify(row.fid)) as Array<{ title: string }>;
      out.push({ foreignProjectId: row.fid, docCount: row.n, sampleTitles: titles.map((t) => t.title), suggestion: this.suggest(row.fid, registered) });
    }
    return out;
  }

  /** Tag match first, then name. More than one candidate at the deciding tier means no suggestion. */
  private suggest(foreignId: string, registered: ProjectInfo[]): UnassignedForeignProject['suggestion'] {
    let stored: { name: string | null; tag: string | null } | undefined;
    try {
      stored = this.db.prepare('SELECT name, tag FROM dd_project_refs WHERE project_id = ?').get(foreignId) as typeof stored;
    } catch {
      return null;
    }
    if (!stored) return null;
    const fold = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
    for (const [basis, want, pick] of [
      ['tag', fold(stored.tag), (p: ProjectInfo) => fold(p.tag)],
      ['name', fold(stored.name), (p: ProjectInfo) => fold(p.name)]
    ] as const) {
      if (!want) continue;
      const matches = registered.filter((project) => pick(project) === want);
      if (matches.length === 1) return { projectId: matches[0]!.id, name: matches[0]!.name ?? matches[0]!.id, basis };
      if (matches.length > 1) return null;
    }
    return null;
  }
}
