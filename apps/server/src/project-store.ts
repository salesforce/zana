import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { atomicDurableWrite, createSerializedTransactionQueue } from './durable-store.js';

/**
 * Server-owned project mutation service (Runtime Migration Backlog, Durable
 * Foundation #4's first slice: add/update only). Mirrors
 * `src/main/store.ts`'s `addProject`/`updateProject` path-confinement and
 * dedup rules on top of the durable-store primitive so the on-disk
 * `projects.json` shape stays byte-compatible with the legacy Electron-main
 * writer while neither side has crossed an IPC boundary yet. This is
 * deliberately a bounded subset of `Project` (id/name/path/color/timestamps/
 * tag/category) — remote projects, launch defaults, favorites, and the
 * Quick Agent scratch-folder heuristics stay on the legacy path until their
 * own bounded migration steps.
 */
export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  color?: string;
  createdAt: number;
  lastActiveAt: number;
  sortIndex?: number;
  tag?: string;
  category?: string;
  remote?: unknown;
}

export type ProjectMutationPatch = Partial<Pick<ProjectRecord, 'name' | 'color' | 'category'>>;

/** The 8-color project palette. First entry is the conventional default.
 *  Mirrors `packages/domain/src/project-colors.ts` byte-for-byte. */
export const PROJECT_COLORS = [
  '#2f81f7', // blue (default)
  '#3fb950', // green
  '#d4a017', // gold
  '#bc8cff', // magenta
  '#39c5cf', // cyan
  '#f85149', // red
  '#ff7b72', // pink
  '#8b949e' // gray
] as const;

/** Least-used-color-first assignment, ties broken by palette order. */
export function pickProjectColor(inUse: Iterable<string | undefined | null>): string {
  const counts = new Map<string, number>(PROJECT_COLORS.map((c) => [c, 0]));
  for (const c of inUse) {
    if (c && counts.has(c)) counts.set(c, counts.get(c)! + 1);
  }
  let best: string = PROJECT_COLORS[0];
  let bestCount = Infinity;
  for (const c of PROJECT_COLORS) {
    const n = counts.get(c)!;
    if (n < bestCount) {
      best = c;
      bestCount = n;
    }
  }
  return best;
}

const TAG_REGEX = /^[a-z0-9][a-z0-9_-]{0,32}$/;
const TAG_MAX_LEN = 33; // 1 + 32

/** Mirrors `src/main/store.ts`'s `slugifyTag` byte-for-byte. */
export function slugifyTag(name: string): string {
  const base = (name || '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, TAG_MAX_LEN);
  if (base.length === 0 || !TAG_REGEX.test(base)) return 'project';
  return base;
}

/** Mirrors `src/main/store.ts`'s `dedupeTag` byte-for-byte. */
export function dedupeTag(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; n < 10000; n++) {
    const suffix = `-${n}`;
    const trimmedBase = base.length + suffix.length > TAG_MAX_LEN
      ? base.slice(0, TAG_MAX_LEN - suffix.length).replace(/-+$/, '') || 'project'
      : base;
    const candidate = `${trimmedBase}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 24)}-${randomUUID().slice(0, 8)}`;
}

export function pickTag(name: string, taken: Set<string>): string {
  return dedupeTag(slugifyTag(name), taken);
}

/** Category label the "Extensions" grouping uses. Mirrors
 *  `EXTENSION_PROJECT_CATEGORY` in `src/main/store.ts`. */
export const EXTENSION_PROJECT_CATEGORY = 'Extensions';

/**
 * Best-effort: does `dir` hold a local extension's SOURCE — an
 * `extension.json` whose `id` matches the folder name? Mirrors
 * `src/main/store.ts`'s `detectExtensionSource`. Throw-free: any read/parse/
 * shape failure just means "not an extension source."
 */
function detectExtensionSource(dir: string): { title: string } | null {
  try {
    const manifestPath = `${dir}/extension.json`;
    if (!existsSync(manifestPath)) return null;
    const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.id !== 'string' || raw.id !== basename(dir)) return null;
    if (typeof raw.title !== 'string' || !raw.title) return null;
    const entry = raw.entry as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== 'object') return null;
    if (typeof entry.renderer !== 'string' && typeof entry.main !== 'string') return null;
    return { title: raw.title };
  } catch {
    return null;
  }
}

const PROJECTS_SCHEMA_VERSION = 1 as const;

interface ProjectsFile {
  version: typeof PROJECTS_SCHEMA_VERSION;
  projects: ProjectRecord[];
}

interface ProjectsSnapshot {
  file: ProjectsFile;
  hash: string | null;
}

export interface ProjectStoreOptions {
  /** Absolute path to `projects.json`. Injectable so tests never touch a real HOME. */
  projectsFile: string;
  /** App-owned placeholder directory for remote projects, if this store owns it. */
  remotePlaceholderRoot?: string;
}

export interface ProjectStore {
  list(): ProjectRecord[];
  add(path: string): Promise<ProjectRecord>;
  update(id: string, patch: ProjectMutationPatch): Promise<ProjectRecord | null>;
  reorder(orderedIds: string[]): Promise<ProjectRecord[]>;
  touch(id: string): Promise<ProjectRecord | null>;
  remove(id: string): Promise<ProjectRecord | null>;
}

function canonicalProjectPath(path: string): string {
  if (!isAbsolute(path)) throw new Error('project path must be absolute');
  const realPath = realpathSync(path);
  if (!statSync(realPath).isDirectory()) throw new Error('not a directory');
  return realPath;
}

function canonicalStoredLocalPath(project: ProjectRecord): string | null {
  if ('remote' in project) return null;
  try {
    return canonicalProjectPath(project.path);
  } catch {
    // Preserve an inaccessible legacy row rather than treating it as a match.
    return null;
  }
}

function sanitizeProjectPatch(patch: ProjectMutationPatch): ProjectMutationPatch {
  const safePatch: ProjectMutationPatch = {};
  if ('name' in patch && patch.name !== undefined) {
    if (typeof patch.name !== 'string' || patch.name.length === 0 || patch.name.length > 256) {
      throw new Error('project name must be between 1 and 256 characters');
    }
    for (const char of patch.name) {
      const code = char.charCodeAt(0);
      if (code < 0x20 || code === 0x7f) throw new Error('project name contains control characters');
    }
    safePatch.name = patch.name;
  }
  if ('category' in patch && patch.category !== undefined) {
    if (patch.category !== EXTENSION_PROJECT_CATEGORY) throw new Error('unsupported project category');
    safePatch.category = patch.category;
  }
  if ('color' in patch && patch.color !== undefined && (PROJECT_COLORS as readonly string[]).includes(patch.color)) {
    safePatch.color = patch.color;
  }
  return safePatch;
}

function backfillProjectMetadata(projects: ProjectRecord[]): ProjectRecord[] {
  const taken = new Set(projects.map((project) => project.tag).filter((tag): tag is string => !!tag && TAG_REGEX.test(tag)));
  const inUseColors = projects.map((project) => project.color);
  return projects.map((project) => {
    let next = project;
    if (!next.tag || !TAG_REGEX.test(next.tag)) {
      const tag = pickTag(next.name, taken);
      taken.add(tag);
      next = { ...next, tag };
    }
    if (!next.color || !(PROJECT_COLORS as readonly string[]).includes(next.color)) {
      const color = pickProjectColor(inUseColors);
      inUseColors.push(color);
      next = { ...next, color };
    }
    return next;
  });
}

/**
 * Server-owned project mutation store. Every mutation is serialized through
 * one in-process queue (Rule 4) and CAS-guarded against the on-disk hash
 * (Durable Foundation #1's `atomicDurableWrite`) so a concurrent external
 * writer — the legacy Electron-main `store.ts`, during the migration window —
 * can never be silently clobbered.
 */
export function createProjectStore({ projectsFile, remotePlaceholderRoot }: ProjectStoreOptions): ProjectStore {
  const readSnapshot = (): ProjectsSnapshot => {
    try {
      if (!existsSync(projectsFile)) {
        return { file: { version: PROJECTS_SCHEMA_VERSION, projects: [] }, hash: null };
      }
      const bytes = readFileSync(projectsFile);
      const raw = JSON.parse(bytes.toString('utf8')) as unknown;
      const projects = Array.isArray(raw)
        ? (raw as ProjectRecord[])
        : Array.isArray((raw as { projects?: unknown })?.projects)
          ? ((raw as { projects: ProjectRecord[] }).projects)
          : [];
      const hash = createHash('sha256').update(bytes).digest('hex');
      return { file: { version: PROJECTS_SCHEMA_VERSION, projects }, hash };
    } catch {
      return { file: { version: PROJECTS_SCHEMA_VERSION, projects: [] }, hash: null };
    }
  };

  const writeProjects = (projects: ProjectRecord[], expectedHash: string | null): void => {
    const dir = dirname(projectsFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file: ProjectsFile = { version: PROJECTS_SCHEMA_VERSION, projects };
    atomicDurableWrite(projectsFile, Buffer.from(JSON.stringify(file, null, 2)), { expectedHash });
  };

  const queue = createSerializedTransactionQueue();

  return {
    list(): ProjectRecord[] {
      return readSnapshot().file.projects;
    },

    add(path: string): Promise<ProjectRecord> {
      return queue.run(async () => {
        const canonicalPath = canonicalProjectPath(path);

        const { file, hash } = readSnapshot();
        const projects = file.projects;
        const ext = detectExtensionSource(canonicalPath);

        const existingIndex = projects.findIndex((p) => canonicalStoredLocalPath(p) === canonicalPath);
        if (existingIndex !== -1) {
          const existing = { ...projects[existingIndex], path: canonicalPath, lastActiveAt: Date.now() };
          if (ext && existing.category !== EXTENSION_PROJECT_CATEGORY) {
            existing.category = EXTENSION_PROJECT_CATEGORY;
            existing.name = `Ext: ${ext.title}`.slice(0, 256);
          }
          const next = [...projects];
          next[existingIndex] = existing;
          writeProjects(next, hash);
          return existing;
        }

        const displayName = ext ? `Ext: ${ext.title}`.slice(0, 256) : (basename(canonicalPath) || canonicalPath);
        const taken = new Set(projects.map((p) => p.tag).filter((t): t is string => !!t));
        const tag = pickTag(ext ? (basename(canonicalPath) || canonicalPath) : displayName, taken);
        const color = pickProjectColor(projects.map((p) => p.color));
        const project: ProjectRecord = {
          id: randomUUID(),
          name: displayName,
          path: canonicalPath,
          color,
          createdAt: Date.now(),
          lastActiveAt: Date.now(),
          tag,
          ...(ext ? { category: EXTENSION_PROJECT_CATEGORY } : {})
        };
        writeProjects([...projects, project], hash);
        return project;
      });
    },

    update(id: string, patch: ProjectMutationPatch): Promise<ProjectRecord | null> {
      return queue.run(async () => {
        const { file, hash } = readSnapshot();
        const projects = file.projects;
        const index = projects.findIndex((p) => p.id === id);
        if (index === -1) return null;

        // The renderer is untrusted (Rule 1) and `color` is later interpolated
        // into inline styles, so only a known palette member is accepted; any
        // other value is dropped from the patch rather than applied.
        const safePatch = sanitizeProjectPatch(patch);

        const next = { ...projects[index], ...safePatch };
        const nextProjects = [...projects];
        nextProjects[index] = next;
        writeProjects(nextProjects, hash);
        return next;
      });
    },

    reorder(orderedIds: string[]): Promise<ProjectRecord[]> {
      return queue.run(async () => {
        const { file, hash } = readSnapshot();
        const byId = new Map(file.projects.map((project) => [project.id, project]));
        const next: ProjectRecord[] = [];
        for (const id of orderedIds) {
          const project = byId.get(id);
          if (!project) continue;
          next.push(project);
          byId.delete(id);
        }
        next.push(...byId.values());
        const ordered = next.map((project, sortIndex) => ({ ...project, sortIndex }));
        writeProjects(ordered, hash);
        return ordered;
      });
    },

    touch(id: string): Promise<ProjectRecord | null> {
      return queue.run(async () => {
        const { file, hash } = readSnapshot();
        const projects = backfillProjectMetadata(file.projects);
        const index = projects.findIndex((project) => project.id === id);
        if (index === -1) return null;
        const project = { ...projects[index], lastActiveAt: Date.now() };
        projects[index] = project;
        writeProjects(projects, hash);
        return project;
      });
    },

    remove(id: string): Promise<ProjectRecord | null> {
      return queue.run(async () => {
        const { file, hash } = readSnapshot();
        const index = file.projects.findIndex((project) => project.id === id);
        if (index === -1) return null;
        const removed = file.projects[index];
        writeProjects(file.projects.filter((_, current) => current !== index), hash);

        // This directory is app-created for remote projects. Never trust an id
        // as a path segment, and only remove the exact placeholder recorded by
        // the server-authoritative project row.
        if (
          remotePlaceholderRoot &&
          removed.remote &&
          basename(id) === id &&
          removed.path === join(remotePlaceholderRoot, id) &&
          existsSync(removed.path)
        ) {
          try {
            rmSync(removed.path, { recursive: true, force: true });
          } catch {
            // Removing a project record must not fail because best-effort
            // cleanup of its app-owned placeholder cannot complete.
          }
        }
        return removed;
      });
    }
  };
}
