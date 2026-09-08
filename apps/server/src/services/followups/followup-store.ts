/**
 * On-disk persistence for {@link FollowUp} records — the durable twin of the
 * ephemeral "Needs you" idle badge. A thin, pure FS module (the lifecycle /
 * dedup brain is {@link FollowUpManager}); modelled on `goal-store.ts`:
 *  - one JSON file per record under `~/.zcc/followups` (global) or
 *    `<project>/.zcc/followups` (per-project),
 *  - atomic tmp+rename writes (CLAUDE.md rule 4),
 *  - tolerant validation so a hand-edited / older file still loads with defaults.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { join } from 'node:path';
import type {
  FollowUp,
  FollowUpKind,
  FollowUpOrigin,
  FollowUpStatus,
  Project
} from '@zana-ai/zcc-domain/product';

import { electronZccDataDir } from '../../electron-data-dir.js';

export const globalDir = () => join(electronZccDataDir(), 'followups');
export const projectDir = (project: Project) => join(project.path, '.zcc', 'followups');

const VALID_STATUS: FollowUpStatus[] = ['open', 'resolved', 'dismissed'];
const VALID_KIND: FollowUpKind[] = ['question', 'decision', 'note'];

/** Cap on the option list so a hand-edited / agent-supplied file stays a scannable
 *  picker, not a survey (mirrors the inbox MAX_OPTIONS bound). */
const MAX_OPTIONS = 20;

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Coerce arbitrary JSON into a clean option list, or undefined when absent/empty. */
function sanitizeOptions(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const cleaned = raw
    .filter((o): o is string => typeof o === 'string')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)
    .slice(0, MAX_OPTIONS);
  return cleaned.length > 0 ? cleaned : undefined;
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

/** Coerce arbitrary JSON into a clean {@link FollowUpOrigin}. Defaults to user. */
function sanitizeOrigin(raw: unknown): FollowUpOrigin {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (r.source === 'idle-triage' && typeof r.sessionId === 'string') {
    const confidence =
      typeof r.confidence === 'number' && Number.isFinite(r.confidence)
        ? Math.max(0, Math.min(1, r.confidence))
        : undefined;
    return { source: 'idle-triage', sessionId: r.sessionId, confidence };
  }
  if (r.source === 'agent' && typeof r.sessionId === 'string') {
    return { source: 'agent', sessionId: r.sessionId };
  }
  return { source: 'user' };
}

/**
 * Validate a follow-up JSON file. Returns the record on success, or `{ error }`
 * so the caller can log why a file was dropped. Tolerant of hand edits: missing
 * optional pieces get defaults. Pure; exported for tests.
 */
export function validateFollowUpFile(raw: unknown): FollowUp | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) return { error: 'missing id' };
  if (typeof r.title !== 'string' || !r.title.trim()) return { error: 'missing title' };
  if (typeof r.projectId !== 'string' || !r.projectId.trim()) return { error: 'missing projectId' };

  const status =
    typeof r.status === 'string' && VALID_STATUS.includes(r.status as FollowUpStatus)
      ? (r.status as FollowUpStatus)
      : 'open';
  const kind =
    typeof r.kind === 'string' && VALID_KIND.includes(r.kind as FollowUpKind)
      ? (r.kind as FollowUpKind)
      : 'question';
  const origin = sanitizeOrigin(r.origin);

  const followUp: FollowUp = {
    id: r.id,
    projectId: r.projectId,
    title: r.title.trim(),
    detail: typeof r.detail === 'string' ? r.detail : undefined,
    kind,
    status,
    origin,
    options: sanitizeOptions(r.options),
    sessionId:
      typeof r.sessionId === 'string'
        ? r.sessionId
        : origin.source !== 'user'
          ? origin.sessionId
          : undefined,
    resolution: typeof r.resolution === 'string' ? r.resolution : undefined,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
    resolvedAt: typeof r.resolvedAt === 'string' ? r.resolvedAt : undefined,
    spawnedAt: typeof r.spawnedAt === 'string' ? r.spawnedAt : undefined,
    dedupeKey: typeof r.dedupeKey === 'string' && r.dedupeKey.trim() ? r.dedupeKey : undefined,
    occurrences:
      typeof r.occurrences === 'number' && Number.isFinite(r.occurrences) && r.occurrences > 1
        ? Math.floor(r.occurrences)
        : undefined
  };
  return followUp;
}

function readFollowUpFile(
  path: string,
  onInvalid?: (path: string, reason: string) => void
): FollowUp | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    onInvalid?.(path, `unreadable JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const result = validateFollowUpFile(parsed);
  if ('error' in result) {
    onInvalid?.(path, result.error);
    return null;
  }
  return result;
}

function listInDir(
  dir: string,
  source: FollowUp['source'],
  onInvalid?: (path: string, reason: string) => void
): FollowUp[] {
  if (!existsSync(dir)) return [];
  const out: FollowUp[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const f = readFollowUpFile(join(dir, name), onInvalid);
    if (f) {
      f.source = source;
      out.push(f);
    }
  }
  return out;
}

/**
 * Walk the global directory and each project's per-project directory. Follow-ups
 * whose project no longer exists are skipped (kept on disk in case it comes
 * back). `onInvalid` fires once per unreadable / invalid file.
 */
export function listAllFollowUps(
  projects: Project[],
  onInvalid?: (path: string, reason: string) => void
): FollowUp[] {
  const out = listInDir(globalDir(), 'global', onInvalid);
  for (const p of projects) {
    out.push(...listInDir(projectDir(p), { projectId: p.id }, onInvalid));
  }
  return out;
}

function fileFor(followUp: FollowUp, projects: Project[]): string {
  let dir = globalDir();
  const src = followUp.source;
  if (src && src !== 'global') {
    const project = projects.find((x) => x.id === src.projectId);
    if (project) dir = projectDir(project);
  }
  ensureDir(dir);
  return join(dir, `${followUp.id}.json`);
}

export function saveFollowUp(followUp: FollowUp, projects: Project[]): void {
  writeJsonAtomic(fileFor(followUp, projects), stripTransient(followUp));
}

function locateFollowUpFile(id: string, projects: Project[]): string | null {
  const candidates: string[] = [join(globalDir(), `${id}.json`)];
  for (const p of projects) candidates.push(join(projectDir(p), `${id}.json`));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function deleteFollowUp(id: string, projects: Project[]): boolean {
  const path = locateFollowUpFile(id, projects);
  if (!path) return false;
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `source` is loader-only metadata; never written to disk. */
function stripTransient(followUp: FollowUp): Omit<FollowUp, 'source'> {
  const { source: _source, ...rest } = followUp;
  void _source;
  return rest;
}
