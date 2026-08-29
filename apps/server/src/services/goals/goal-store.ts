import { app } from 'electron';
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
  Goal,
  GoalAssignment,
  GoalDriver,
  GoalIteration,
  GoalStatus,
  GoalVerdict,
  LaunchProfileId,
  Project
} from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';

export const globalDir = () => join(app.getPath('home'), '.zcc', 'goals');
export const projectDir = (project: Project) => join(project.path, '.zcc', 'goals');
const VALID_DRIVERS: GoalDriver[] = ['native', 'zana-autopilot'];
const VALID_STATUS: GoalStatus[] = [
  'draft',
  'active',
  'paused',
  'achieved',
  'exhausted',
  'escalated',
  'cancelled'
];
const VALID_VERDICTS: GoalVerdict[] = ['pass', 'partial', 'fail', 'unknown'];

/** History buffer cap. Hand-editing higher in the JSON works; the UI won't surface more. */
const MAX_RETAIN = 100;

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeJsonAtomic(file: string, value: unknown) {
  const payload = JSON.stringify(value, null, 2);
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, file);
}

export function clampRetain(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 20;
  return Math.max(1, Math.min(MAX_RETAIN, Math.round(n)));
}

/** Coerce an arbitrary value to a clean string[] (drops non-strings, trims, drops blanks). */
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

function sanitizeAssignment(raw: unknown): GoalAssignment {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind =
    r.kind === 'persona' || r.kind === 'team' || r.kind === 'profile' ? r.kind : 'profile';
  if (kind === 'persona') {
    return { kind, personaId: typeof r.personaId === 'string' ? r.personaId : undefined };
  }
  if (kind === 'team') {
    return { kind, teamId: typeof r.teamId === 'string' ? r.teamId : undefined };
  }
  const profile =
    typeof r.profile === 'string' && VALID_PROFILES.includes(r.profile as LaunchProfileId)
      ? (r.profile as LaunchProfileId)
      : 'claude-yolo';
  return { kind: 'profile', profile };
}

function sanitizeCadence(raw: unknown): Goal['cadence'] {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (typeof r.every === 'string' && r.every.trim()) return { every: r.every };
  if (r.mode === 'manual-approve') return { mode: 'manual-approve' };
  return { mode: 'continuous' };
}

function sanitizeIteration(raw: unknown): GoalIteration | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.at !== 'string') return null;
  return {
    id: r.id,
    at: r.at,
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : undefined,
    verdict:
      typeof r.verdict === 'string' && VALID_VERDICTS.includes(r.verdict as GoalVerdict)
        ? (r.verdict as GoalVerdict)
        : undefined,
    rationale: typeof r.rationale === 'string' ? r.rationale : undefined,
    confidence:
      typeof r.confidence === 'number' && Number.isFinite(r.confidence)
        ? Math.max(0, Math.min(1, r.confidence))
        : undefined,
    report: typeof r.report === 'string' ? r.report : undefined,
    durationMs: typeof r.durationMs === 'number' ? r.durationMs : undefined,
    finishedAt: typeof r.finishedAt === 'string' ? r.finishedAt : undefined,
    error: typeof r.error === 'string' ? r.error : undefined
  };
}

/**
 * Validate a goal JSON file. Returns the goal on success, or `{ error }` on
 * failure so callers can log the reason rather than silently dropping bad files.
 * Tolerant of hand-edited / older files: missing optional pieces get defaults.
 */
export function validateGoalFile(raw: unknown): Goal | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) return { error: 'missing id' };
  if (typeof r.title !== 'string' || !r.title.trim()) return { error: 'missing title' };
  if (typeof r.projectId !== 'string' || !r.projectId.trim()) return { error: 'missing projectId' };
  if (typeof r.statement !== 'string' || !r.statement.trim()) return { error: 'missing statement' };

  const driver =
    typeof r.driver === 'string' && VALID_DRIVERS.includes(r.driver as GoalDriver)
      ? (r.driver as GoalDriver)
      : 'native';
  const status =
    typeof r.status === 'string' && VALID_STATUS.includes(r.status as GoalStatus)
      ? (r.status as GoalStatus)
      : 'draft';

  const rawHistory = (r.history && typeof r.history === 'object' ? r.history : {}) as Record<
    string,
    unknown
  >;
  const iterations = Array.isArray(rawHistory.iterations)
    ? (rawHistory.iterations
        .map(sanitizeIteration)
        .filter((x): x is GoalIteration => x !== null))
    : [];

  const goal: Goal = {
    id: r.id,
    projectId: r.projectId,
    title: r.title.trim(),
    statement: r.statement,
    successCriteria: toStringArray(r.successCriteria),
    driver,
    assignment: sanitizeAssignment(r.assignment),
    cadence: sanitizeCadence(r.cadence),
    maxIterations:
      typeof r.maxIterations === 'number' && r.maxIterations > 0
        ? Math.min(100, Math.round(r.maxIterations))
        : 10,
    iteration: typeof r.iteration === 'number' && r.iteration >= 0 ? Math.round(r.iteration) : 0,
    noProgressLimit:
      typeof r.noProgressLimit === 'number' && r.noProgressLimit > 0
        ? Math.round(r.noProgressLimit)
        : 2,
    status,
    history: { retain: clampRetain(rawHistory.retain as number | undefined), iterations },
    externalRef: typeof r.externalRef === 'string' ? r.externalRef : undefined,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString()
  };
  return goal;
}

function readGoalFile(
  path: string,
  onInvalid?: (path: string, reason: string) => void
): Goal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    onInvalid?.(path, `unreadable JSON: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  const result = validateGoalFile(parsed);
  if ('error' in result) {
    onInvalid?.(path, result.error);
    return null;
  }
  return result;
}

function listInDir(
  dir: string,
  source: Goal['source'],
  onInvalid?: (path: string, reason: string) => void
): Goal[] {
  if (!existsSync(dir)) return [];
  const out: Goal[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const g = readGoalFile(join(dir, name), onInvalid);
    if (g) {
      g.source = source;
      out.push(g);
    }
  }
  return out;
}

/**
 * Walk the global directory and each project's per-project directory. Goals
 * whose project no longer exists are skipped (kept on disk in case the project
 * comes back). `onInvalid` fires once per unreadable / invalid file.
 */
export function listAllGoals(
  projects: Project[],
  onInvalid?: (path: string, reason: string) => void
): Goal[] {
  const out = listInDir(globalDir(), 'global', onInvalid);
  for (const p of projects) {
    out.push(...listInDir(projectDir(p), { projectId: p.id }, onInvalid));
  }
  return out;
}

function fileFor(goal: Goal, projects: Project[]): string {
  let dir = globalDir();
  const src = goal.source;
  if (src && src !== 'global') {
    const project = projects.find((x) => x.id === src.projectId);
    if (project) dir = projectDir(project);
  }
  ensureDir(dir);
  return join(dir, `${goal.id}.json`);
}

export function saveGoal(goal: Goal, projects: Project[]): void {
  writeJsonAtomic(fileFor(goal, projects), stripTransient(goal));
}

function locateGoalFile(id: string, projects: Project[]): string | null {
  const candidates: string[] = [join(globalDir(), `${id}.json`)];
  for (const p of projects) candidates.push(join(projectDir(p), `${id}.json`));
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

export function deleteGoal(id: string, projects: Project[]): boolean {
  const path = locateGoalFile(id, projects);
  if (!path) return false;
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}

/** `source` is loader-only metadata; never written to disk. */
function stripTransient(goal: Goal): Omit<Goal, 'source'> {
  const { source: _source, ...rest } = goal;
  void _source;
  return rest;
}
