import type { ScheduledTask, ScheduleCatchUp, ScheduleRetryPolicy, ScheduleRunConversation, ScheduleStatus, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import { validateCadence } from '@zana-ai/zcc-domain/schedule-spec';
import { isValidConversationId } from '@zana-ai/zcc-domain/schedule-health';

/** Upper bound on pending reservations + active Squad runs kept per schedule file. */
const MAX_UNRESOLVED_RUNS = 100;

function clampInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isoOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : undefined;
}

/** Normalise a raw `catchUp` value; anything invalid is dropped (= Classic). */
export function normalizeCatchUp(raw: unknown): ScheduleCatchUp | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { mode, max } = raw as { mode?: unknown; max?: unknown };
  if (mode !== 'once' && mode !== 'skip' && mode !== 'all') return undefined;
  const clamped = max === undefined ? undefined : clampInt(max, 1, 10);
  return clamped === undefined ? { mode } : { mode, max: clamped };
}

/** Normalise a raw auto-retry policy; anything invalid is dropped (= off). */
export function normalizeRetry(raw: unknown): ScheduleRetryPolicy | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const attempts = clampInt((raw as { attempts?: unknown }).attempts, 0, 5);
  const delayMinutes = clampInt((raw as { delayMinutes?: unknown }).delayMinutes, 1, 1440);
  if (attempts === undefined || delayMinutes === undefined) return undefined;
  return { attempts, delayMinutes };
}

/** A run's recorded conversation, or undefined when malformed: schedule files are editable, so the id must be safe for an argv. */
function normalizeConversation(raw: unknown): ScheduleRunConversation | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const { profile, id, cwd, startedAt } = raw as Record<string, unknown>;
  if (typeof profile !== 'string' || !VALID_PROFILES.includes(profile as LaunchProfileId) || typeof cwd !== 'string' || typeof startedAt !== 'string' || !Number.isFinite(Date.parse(startedAt))) return undefined;
  if (id !== undefined && !isValidConversationId(id)) return undefined;
  return { profile: profile as LaunchProfileId, ...(id !== undefined ? { id } : {}), cwd, startedAt };
}

function normalizePendingRetry(raw: unknown): ScheduleStatus['pendingRetry'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const { rootRunId, attempt, dueAt } = raw as { rootRunId?: unknown; attempt?: unknown; dueAt?: unknown };
  if (typeof rootRunId !== 'string' || !rootRunId || rootRunId.length > 256) return undefined;
  const n = typeof attempt === 'number' && Number.isInteger(attempt) && attempt >= 2 && attempt <= 6 ? attempt : undefined;
  const due = isoOrUndefined(dueAt);
  if (n === undefined || due === undefined) return undefined;
  return { rootRunId, attempt: n, dueAt: due };
}

// Keys this loader understands (carried, or deliberately dropped). Anything else
// is a newer version's field and is preserved (C5) so it survives our saves.
const KNOWN_TASK_KEYS = new Set([
  'id', 'name', 'description', 'enabled', 'projectId', 'profile', 'personaId', 'extraArgs', 'prompt',
  'inboxLevel', 'notifyInbox', 'autoCloseOnFinish', 'maxDurationMinutes', 'group', 'schedule', 'overlap',
  'history', 'status', 'createdAt', 'updatedAt', 'catchUp', 'retry', 'kind', 'teamId', 'planSource'
]);
const KNOWN_STATUS_KEYS = new Set([
  'runCount', 'runs', 'lastRunAt', 'lastRunResult', 'lastRunSessionId', 'nextRunAt',
  'slotCursorAt', 'missedFloorAt', 'pendingRetry'
]);
// Never preserved: runtime/derived data that must not be persisted.
const NEVER_PRESERVE_TASK_KEYS = new Set(['source', 'external', '__proto__', 'constructor', 'prototype']);
const NEVER_PRESERVE_STATUS_KEYS = new Set(['queuedAt', '__proto__', 'constructor', 'prototype']);
const MAX_EXTRAS_JSON = 4096;

function collectExtras(obj: Record<string, unknown>, known: Set<string>, deny: Set<string>, budget: { left: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (known.has(key) || deny.has(key)) continue;
    // Fill the budget field by field: one oversized future field drops only itself.
    const size = jsonLength({ [key]: obj[key] });
    if (size > budget.left) continue;
    budget.left -= size;
    out[key] = obj[key];
  }
  return out;
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

/** Unknown top-level and status keys, kept field by field within a shared 4 KB budget. */
function preservedExtras(r: Record<string, unknown>): { task: Record<string, unknown>; status: Record<string, unknown> } {
  const budget = { left: MAX_EXTRAS_JSON };
  const task = collectExtras(r, KNOWN_TASK_KEYS, NEVER_PRESERVE_TASK_KEYS, budget);
  const status = r.status && typeof r.status === 'object'
    ? collectExtras(r.status as Record<string, unknown>, KNOWN_STATUS_KEYS, NEVER_PRESERVE_STATUS_KEYS, budget)
    : {};
  return { task, status };
}

/**
 * Validate a schedule JSON file. Returns the schedule on success, or a string
 * reason on failure (so callers can log the reason rather than silently
 * dropping bad files). Hand-edited files are common — a typoed `every` like
 * `"1 hour"` used to fall through to MIN_INTERVAL_MS and silently fire every
 * 60s; we now reject those at load time.
 */
export function validateScheduleFile(raw: unknown): ScheduledTask | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id.trim()) return { error: 'missing id' };
  if (typeof r.name !== 'string' || !r.name.trim()) return { error: 'missing name' };
  if (typeof r.enabled !== 'boolean') return { error: 'enabled must be boolean' };
  if (typeof r.projectId !== 'string' || !r.projectId.trim()) return { error: 'missing projectId' };
  if (typeof r.profile !== 'string' || !VALID_PROFILES.includes(r.profile as LaunchProfileId)) {
    return { error: `invalid profile: ${String(r.profile)}` };
  }
  const kind = r.kind === undefined ? 'agent' : r.kind;
  if (kind !== 'agent' && kind !== 'team') return { error: 'invalid schedule kind' };
  if (kind === 'team' && (typeof r.teamId !== 'string' || !r.teamId.trim())) return { error: 'team schedule requires teamId' };
  const teamId = typeof r.teamId === 'string' ? r.teamId.trim() : undefined;
  if (r.planSource !== undefined && r.planSource !== 'provided' && r.planSource !== 'infer') return { error: 'invalid planSource' };
  const schedule = r.schedule as { every?: unknown; cron?: unknown; tz?: unknown } | undefined;
  if (!schedule || typeof schedule !== 'object') {
    return { error: 'missing schedule' };
  }
  const cadence = {
    every: typeof schedule.every === 'string' ? schedule.every : undefined,
    cron: typeof schedule.cron === 'string' ? schedule.cron : undefined,
    tz: typeof schedule.tz === 'string' ? schedule.tz : undefined
  };
  // Enforces the exactly-one-of {every,cron} invariant AND that the chosen
  // cadence parses. Rejects a hand-edited file rather than silently firing.
  const cadenceError = validateCadence(cadence);
  if (cadenceError) return { error: `schedule: ${cadenceError}` };
  const rawRuns = r.status && typeof r.status === 'object' ? (r.status as { runs?: unknown }).runs : undefined;
  if (rawRuns !== undefined && !Array.isArray(rawRuns)) return { error: 'runs must be an array' };
  const runs: ScheduledTask['status']['runs'] = [];
  let terminalRecords = 0;
  let unresolvedRecords = 0;
  for (const value of (rawRuns ?? []) as unknown[]) {
    if (!value || typeof value !== 'object') return { error: 'invalid run' };
    const run = value as ScheduledTask['status']['runs'][number];
    if (run.conversation !== undefined) {
      const conversation = normalizeConversation(run.conversation);
      if (conversation) run.conversation = conversation;
      else delete run.conversation;
    }
    if (typeof run.at !== 'string' || !Number.isFinite(Date.parse(run.at)) ||
        !['success', 'error', 'skipped', 'incomplete'].includes(run.result)) return { error: 'invalid run timestamp or result' };
    if (run.sessionId !== undefined && typeof run.sessionId !== 'string') return { error: 'invalid run session' };
    if (run.launchState !== undefined && !['pending', 'running', 'failed'].includes(run.launchState)) return { error: 'invalid run launch state' };
    if (run.launchKind !== undefined && run.launchKind !== 'agent' && run.launchKind !== 'team') return { error: 'invalid run launch kind' };
    if (run.launchState === 'pending' && !run.sessionId && kind !== 'team') return { error: 'pending run requires a reserved session' };
    // Keep unresolved ownership state beyond terminal display history. Dropping
    // it during validation would allow a restart to overlap a live Squad run.
    const activeSquadRun = (run.launchKind ?? kind) === 'team' && run.launchState === 'running' && !!run.executionId && !run.finishedAt;
    if (run.launchState === 'pending' || activeSquadRun) {
      // Unresolved runs are exempt from display history but still bounded so a
      // corrupt or hand-edited file cannot load an unbounded array.
      if (++unresolvedRecords > MAX_UNRESOLVED_RUNS) return { error: 'too many unresolved runs' };
      runs.push(run);
    } else if (terminalRecords++ < 100) {
      runs.push(run);
    }
  }
  const extras = preservedExtras(r);
  const rawStatus = r.status && typeof r.status === 'object' ? (r.status as Record<string, unknown>) : undefined;
  const catchUp = normalizeCatchUp(r.catchUp);
  const retry = normalizeRetry(r.retry);
  const slotCursorAt = isoOrUndefined(rawStatus?.slotCursorAt);
  const missedFloorAt = isoOrUndefined(rawStatus?.missedFloorAt);
  // A pending retry only means something under a live retry policy.
  const pendingRetry = retry && retry.attempts >= 1 ? normalizePendingRetry(rawStatus?.pendingRetry) : undefined;
  // Defensive defaults — older hand-edited files may be missing pieces.
  const task: ScheduledTask = {
    ...(extras.task as object),
    id: r.id,
    name: r.name,
    description: typeof r.description === 'string' ? r.description : undefined,
    enabled: r.enabled,
    projectId: r.projectId,
    profile: r.profile as LaunchProfileId,
    kind,
    teamId: kind === 'team' ? teamId : undefined,
    planSource: kind === 'team' ? (r.planSource ?? 'infer') : undefined,
    extraArgs: Array.isArray(r.extraArgs)
      ? (r.extraArgs as unknown[]).filter((s): s is string => typeof s === 'string')
      : undefined,
    prompt: typeof r.prompt === 'string' ? r.prompt : undefined,
    // Inbox loudness. Prefer the new `inboxLevel`; fall back to the legacy
    // boolean `notifyInbox` (true→loud, false→quiet) so older files keep their
    // intent; default `quiet` when neither is present.
    inboxLevel:
      r.inboxLevel === 'silent' || r.inboxLevel === 'quiet' || r.inboxLevel === 'loud'
        ? r.inboxLevel
        : typeof r.notifyInbox === 'boolean'
          ? r.notifyInbox
            ? 'loud'
            : 'quiet'
          : 'quiet',
    // Default ON when omitted (e.g. hand-authored JSON): scheduled sessions are
    // background work and should close when the agent finishes. A schedule that
    // explicitly saved `false` keeps that choice.
    autoCloseOnFinish: typeof r.autoCloseOnFinish === 'boolean' ? r.autoCloseOnFinish : true,
    maxDurationMinutes: typeof r.maxDurationMinutes === 'number' ? r.maxDurationMinutes : undefined,
    group: typeof r.group === 'string' && r.group.trim() ? r.group : undefined,
    schedule: cadence.cron
      ? { cron: cadence.cron, ...(cadence.tz ? { tz: cadence.tz } : {}) }
      : { every: cadence.every! },
    overlap: 'skip',
    history:
      r.history && typeof r.history === 'object' && typeof (r.history as { retain?: unknown }).retain === 'number'
        ? { retain: Number.isFinite((r.history as { retain: number }).retain) ? Math.max(1, Math.min(100, Math.round((r.history as { retain: number }).retain))) : 10 }
        : { retain: 10 },
    status:
      r.status && typeof r.status === 'object'
        ? {
            ...(extras.status as object),
            runCount: typeof (r.status as { runCount?: unknown }).runCount === 'number'
              ? (r.status as { runCount: number }).runCount
              : 0,
            runs,
            lastRunAt: typeof (r.status as { lastRunAt?: unknown }).lastRunAt === 'string'
              ? (r.status as { lastRunAt: string }).lastRunAt
              : undefined,
            lastRunResult:
              (r.status as { lastRunResult?: 'success' | 'error' | 'skipped' | 'incomplete' })
                .lastRunResult,
            lastRunSessionId:
              typeof (r.status as { lastRunSessionId?: unknown }).lastRunSessionId === 'string'
                ? (r.status as { lastRunSessionId: string }).lastRunSessionId
                : undefined,
            nextRunAt: typeof (r.status as { nextRunAt?: unknown }).nextRunAt === 'string'
              ? (r.status as { nextRunAt: string }).nextRunAt
              : undefined,
            ...(slotCursorAt ? { slotCursorAt } : {}),
            ...(missedFloorAt ? { missedFloorAt } : {}),
            ...(pendingRetry ? { pendingRetry } : {})
          }
        : { runCount: 0, runs: [] },
    ...(catchUp ? { catchUp } : {}),
    ...(retry ? { retry } : {}),
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString()
  };
  return task;
}
