import type { ScheduledTask, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import { validateCadence } from '@zana-ai/zcc-domain/schedule-spec';

/** Upper bound on pending reservations + active Squad runs kept per schedule file. */
const MAX_UNRESOLVED_RUNS = 100;
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
  // Defensive defaults — older hand-edited files may be missing pieces.
  const task: ScheduledTask = {
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
              : undefined
          }
        : { runCount: 0, runs: [] },
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString()
  };
  return task;
}
