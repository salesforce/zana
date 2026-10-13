import type { Goal, GoalAssignment, GoalDriver, GoalIteration, GoalStatus, GoalVerdict, LaunchProfileId } from '@zana-ai/zcc-domain/product';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
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
    return { kind, teamId: typeof r.teamId === 'string' && r.teamId.trim() ? r.teamId.trim() : undefined };
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
    executionId: typeof r.executionId === 'string' ? r.executionId : undefined,
    launchRequestId: typeof r.launchRequestId === 'string' ? r.launchRequestId : undefined,
    launchState: r.launchState === 'pending' || r.launchState === 'running' || r.launchState === 'failed' ? r.launchState : undefined,
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
  const terminalStatus =
    r.terminalStatus === 'achieved' || r.terminalStatus === 'exhausted' ||
    r.terminalStatus === 'escalated' || r.terminalStatus === 'cancelled'
      ? r.terminalStatus
      : undefined;

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
    ...(r.planSource === 'provided' || r.planSource === 'infer' ? { planSource: r.planSource } : {}),
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
    terminalStatus,
    terminalMessage: typeof r.terminalMessage === 'string' ? r.terminalMessage : undefined,
    terminalNotificationDelivered: r.terminalNotificationDelivered === true ? true : undefined,
    history: { retain: clampRetain(rawHistory.retain as number | undefined), iterations },
    externalRef: typeof r.externalRef === 'string' ? r.externalRef : undefined,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString()
  };
  if (goal.assignment.kind === 'team' && !goal.assignment.teamId) return { error: 'team goal requires teamId' };
  return goal;
}
