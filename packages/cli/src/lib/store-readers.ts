/**
 * Pure store-reader functions that read the ~/.zcc/*.json files the
 * Electron app uses. Defensive: missing files or malformed JSON never throw,
 * they return empty lists + optional warnings on stderr.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Project,
  Persona,
  ScheduledTask,
  InboxEntry,
  FollowUp,
  FollowUpStatus
} from './types.js';

export interface StoreReadResult<T> {
  data: T;
  warnings: string[];
}

/**
 * Read projects.json. Handles both v0 (bare array) and v1 ({ version, projects }).
 */
export function readProjects(dataDir: string): StoreReadResult<Project[]> {
  const warnings: string[] = [];
  const file = join(dataDir, 'projects.json');

  if (!existsSync(file)) {
    return { data: [], warnings: [] };
  }

  try {
    const content = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(content);

    // Handle both v0 (bare array) and v1 ({ version, projects })
    let projects: unknown[];
    if (Array.isArray(parsed)) {
      projects = parsed;
    } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as any).projects)) {
      projects = (parsed as any).projects;
    } else {
      warnings.push(`projects.json: unexpected shape, expected array or {projects: array}`);
      return { data: [], warnings };
    }

    // Minimal validation: must have id, name, path
    const valid = projects.filter((p): p is Project => {
      if (!p || typeof p !== 'object') return false;
      const proj = p as any;
      return typeof proj.id === 'string' &&
             typeof proj.name === 'string' &&
             typeof proj.path === 'string';
    });

    if (valid.length < projects.length) {
      warnings.push(`projects.json: skipped ${projects.length - valid.length} malformed entries`);
    }

    return { data: valid, warnings };
  } catch (err) {
    warnings.push(`projects.json: ${(err as Error).message}`);
    return { data: [], warnings };
  }
}

/**
 * Read all persona files from both global and per-project directories.
 * Returns merged list with source stamped.
 */
export function readPersonas(
  dataDir: string,
  projects: Project[]
): StoreReadResult<Persona[]> {
  const warnings: string[] = [];
  const personas: Persona[] = [];

  // Read global personas
  const globalDir = join(dataDir, 'personas');
  if (existsSync(globalDir)) {
    const files = readdirSync(globalDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const path = join(globalDir, file);
      try {
        const content = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(content);
        if (isValidPersona(parsed)) {
          personas.push({ ...parsed, source: 'user' });
        } else {
          warnings.push(`personas/${file}: invalid shape, skipped`);
        }
      } catch (err) {
        warnings.push(`personas/${file}: ${(err as Error).message}`);
      }
    }
  }

  // Read per-project personas
  for (const project of projects) {
    const projDir = join(project.path, '.zcc', 'personas');
    if (!existsSync(projDir)) continue;

    const files = readdirSync(projDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const path = join(projDir, file);
      try {
        const content = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(content);
        if (isValidPersona(parsed)) {
          personas.push({
            ...parsed,
            source: { projectId: project.id, projectName: project.name }
          });
        } else {
          warnings.push(`${project.name}/personas/${file}: invalid shape, skipped`);
        }
      } catch (err) {
        warnings.push(`${project.name}/personas/${file}: ${(err as Error).message}`);
      }
    }
  }

  return { data: personas, warnings };
}

function isValidPersona(obj: any): obj is Persona {
  return obj &&
         typeof obj === 'object' &&
         typeof obj.id === 'string' &&
         typeof obj.name === 'string';
}

/**
 * Read all schedule files from both global and per-project directories.
 */
export function readSchedules(
  dataDir: string,
  projects: Project[]
): StoreReadResult<ScheduledTask[]> {
  const warnings: string[] = [];
  const schedules: ScheduledTask[] = [];

  // Read global schedules
  const globalDir = join(dataDir, 'schedules');
  if (existsSync(globalDir)) {
    const files = readdirSync(globalDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const path = join(globalDir, file);
      try {
        const content = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(content);
        if (isValidSchedule(parsed)) {
          schedules.push({ ...parsed, source: 'global' });
        } else {
          warnings.push(`schedules/${file}: invalid shape, skipped`);
        }
      } catch (err) {
        warnings.push(`schedules/${file}: ${(err as Error).message}`);
      }
    }
  }

  // Read per-project schedules
  for (const project of projects) {
    const projDir = join(project.path, '.zcc', 'schedules');
    if (!existsSync(projDir)) continue;

    const files = readdirSync(projDir).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const path = join(projDir, file);
      try {
        const content = readFileSync(path, 'utf-8');
        const parsed = JSON.parse(content);
        if (isValidSchedule(parsed)) {
          schedules.push({ ...parsed, source: { projectId: project.id } });
        } else {
          warnings.push(`${project.name}/schedules/${file}: invalid shape, skipped`);
        }
      } catch (err) {
        warnings.push(`${project.name}/schedules/${file}: ${(err as Error).message}`);
      }
    }
  }

  return { data: schedules, warnings };
}

function isValidSchedule(obj: any): obj is ScheduledTask {
  return obj &&
         typeof obj === 'object' &&
         typeof obj.id === 'string' &&
         typeof obj.name === 'string' &&
         typeof obj.enabled === 'boolean' &&
         typeof obj.projectId === 'string' &&
         typeof obj.profile === 'string';
}

/**
 * Read inbox entries from entries.jsonl (one JSON object per line).
 */
export function readInbox(
  dataDir: string,
  opts?: { limit?: number; projectId?: string }
): StoreReadResult<InboxEntry[]> {
  const warnings: string[] = [];
  const file = join(dataDir, 'inbox', 'entries.jsonl');

  if (!existsSync(file)) {
    return { data: [], warnings: [] };
  }

  try {
    const content = readFileSync(file, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    let entries: InboxEntry[] = [];
    for (let i = 0; i < lines.length; i++) {
      try {
        const parsed = JSON.parse(lines[i]);
        if (isValidInboxEntry(parsed)) {
          entries.push(parsed);
        } else {
          warnings.push(`entries.jsonl line ${i + 1}: invalid shape, skipped`);
        }
      } catch (err) {
        warnings.push(`entries.jsonl line ${i + 1}: ${(err as Error).message}`);
      }
    }

    // Sort by timestamp descending (newest first)
    entries.sort((a, b) => b.ts - a.ts);

    // Filter by project if requested
    if (opts?.projectId) {
      entries = entries.filter(e => e.projectId === opts.projectId);
    }

    // Apply limit
    if (opts?.limit) {
      entries = entries.slice(0, opts.limit);
    }

    return { data: entries, warnings };
  } catch (err) {
    warnings.push(`entries.jsonl: ${(err as Error).message}`);
    return { data: [], warnings };
  }
}

function isValidInboxEntry(obj: any): obj is InboxEntry {
  return obj &&
         typeof obj === 'object' &&
         typeof obj.id === 'string' &&
         typeof obj.ts === 'number' &&
         typeof obj.projectId === 'string';
}

/**
 * Read every follow-up JSON file from the global directory (~/.zcc/followups)
 * and each project's per-project directory (<project>/.zcc/followups). Mirrors
 * the app-side `listAllFollowUps` walk; `source` is stamped for display, matching
 * `readSchedules`. Follow-ups whose project no longer exists are still returned
 * from the global dir but skipped from a dead project's dir (we never visit it).
 */
export function readFollowUps(
  dataDir: string,
  projects: Project[],
  opts?: { projectId?: string; status?: FollowUpStatus }
): StoreReadResult<FollowUp[]> {
  const warnings: string[] = [];
  const followups: FollowUp[] = [];

  const readDir = (dir: string, source: FollowUp['source'], label: string) => {
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const path = join(dir, file);
      try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        if (isValidFollowUp(parsed)) {
          followups.push({ ...parsed, source });
        } else {
          warnings.push(`${label}/${file}: invalid shape, skipped`);
        }
      } catch (err) {
        warnings.push(`${label}/${file}: ${(err as Error).message}`);
      }
    }
  };

  readDir(join(dataDir, 'followups'), 'global', 'followups');
  for (const project of projects) {
    readDir(
      join(project.path, '.zcc', 'followups'),
      { projectId: project.id },
      `${project.name}/followups`
    );
  }

  let data = followups;
  if (opts?.projectId) data = data.filter((f) => f.projectId === opts.projectId);
  if (opts?.status) data = data.filter((f) => f.status === opts.status);

  // Open first, then most-recently-updated — same order as the UI.
  data.sort((a, b) => {
    if ((a.status === 'open') !== (b.status === 'open')) return a.status === 'open' ? -1 : 1;
    return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
  });

  return { data, warnings };
}

function isValidFollowUp(obj: any): obj is FollowUp {
  return obj &&
         typeof obj === 'object' &&
         typeof obj.id === 'string' &&
         typeof obj.title === 'string' &&
         typeof obj.projectId === 'string';
}
