import { validateScheduleFile } from './schedule-validation.js';
export { validateScheduleFile } from './schedule-validation.js';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Project, ScheduledTask } from '@zana-ai/zcc-domain/product';
import { electronZccDataDir } from '../../electron-data-dir.js';

export const globalDir = () => join(electronZccDataDir(), 'schedules');
export const projectDir = (project: Project) => join(project.path, '.zcc', 'schedules');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${randomUUID()}`;
  try {
    writeFileSync(tmp, payload, { mode: 0o600 });
    renameSync(tmp, file);
  } finally { rmSync(tmp, { force: true }); }
}

function readScheduleFile(
  path: string,
  onInvalid?: (path: string, reason: string) => void
): ScheduledTask | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    onInvalid?.(path, `unreadable JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const result = validateScheduleFile(parsed);
  if ('error' in result) {
    onInvalid?.(path, result.error);
    return null;
  }
  return result;
}

function listInDir(
  dir: string,
  source: ScheduledTask['source'],
  onInvalid?: (path: string, reason: string) => void
): ScheduledTask[] {
  if (!existsSync(dir)) return [];
  const out: ScheduledTask[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const t = readScheduleFile(join(dir, name), onInvalid);
    if (t) {
      t.source = source;
      out.push(t);
    }
  }
  return out;
}

/**
 * Walk both the global directory and each project's per-project directory.
 * Per-project schedules whose project no longer exists are skipped (the
 * caller never sees them; they remain on disk in case the project comes
 * back).
 *
 * `onInvalid` is called once per unreadable / invalid file — wire it to
 * `logMainError` so users can spot why their hand-edited schedule isn't
 * loading.
 */
export function listAllSchedules(
  projects: Project[],
  onInvalid?: (path: string, reason: string) => void
): ScheduledTask[] {
  const out = listInDir(globalDir(), 'global', onInvalid);
  for (const p of projects) {
    out.push(...listInDir(projectDir(p), { projectId: p.id }, onInvalid));
  }
  return out;
}

function fileFor(task: ScheduledTask, projects: Project[]): string {
  if (!task.id || task.id !== basename(task.id) || task.id.includes('\\') || task.id === '.' || task.id === '..') throw new Error('Invalid schedule id');
  let dir = globalDir();
  if (task.source && task.source !== 'global') {
    const projectId = task.source.projectId;
    const project = projects.find((x) => x.id === projectId);
    if (!project) throw new Error('Project metadata is unavailable on this machine; no local or global fallback is allowed');
    dir = projectDir(project);
  }
  ensureDir(dir);
  return join(dir, `${task.id}.json`);
}

export function readSchedule(task: ScheduledTask, projects: Project[]): ScheduledTask {
  const file = fileFor(task, projects);
  let reason = 'file is missing';
  const value = readScheduleFile(file, (_path, error) => { reason = error; });
  if (!value) throw new Error(`Cannot read schedule ${task.id}: ${reason}`);
  if (value.id !== task.id || (task.source && task.source !== 'global' && value.projectId !== task.projectId)) {
    throw new Error('Schedule file identity mismatch');
  }
  return { ...value, source: task.source };
}

/** Merge at the synchronous write boundary, including edits with unchanged updatedAt. */
export function saveSchedule(task: ScheduledTask, projects: Project[], definitionPatch: Partial<ScheduledTask> = task): void {
  const file = fileFor(task, projects);
  const next = definitionPatch?.id === task.id
    ? task // Explicit create.
    : { ...readSchedule(task, projects), ...definitionPatch, status: task.status };
  writeJsonAtomic(file, stripTransient(next));
  Object.assign(task, next);
}

/**
 * Locate the on-disk file for a schedule by id. We search global first,
 * then each project dir — id is unique across the whole system.
 */
function locateScheduleFile(id: string, projects: Project[]): string | null {
  const candidates: string[] = [join(globalDir(), `${id}.json`)];
  for (const p of projects) candidates.push(join(projectDir(p), `${id}.json`));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function deleteSchedule(id: string, projects: Project[]): boolean {
  const path = locateScheduleFile(id, projects);
  if (!path) return false;
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `source` is loader-only metadata; never written to disk. */
function stripTransient(task: ScheduledTask): Omit<ScheduledTask, 'source'> {
  const { source: _source, ...rest } = task;
  void _source;
  return rest;
}
