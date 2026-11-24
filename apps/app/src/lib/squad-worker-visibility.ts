import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';

/** A worker whose claim shows no output progress for this long reads as stale (mirrors the server's notice window). */
export const STALE_HEARTBEAT_MS = 5 * 60_000;

export interface SquadWorkerVisibility {
  squad: string;
  /** The conversation the Squad reports to, when it was started from one. */
  owner?: string;
  /** Epoch ms of the worker's latest sign of life on its claim. */
  lastActivityAt?: number;
  /** Age (ms) since the claim last made output progress; absent when the worker holds no claim. */
  heartbeatAgeMs?: number;
  turnCount?: number;
  stale: boolean;
}

/** Compact age: `45s`, `7m`, `2h`. */
export function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

/**
 * What a Sessions row shows for a Squad worker: the Squad, the thread that owns it, and the liveness of the
 * worker's claim. Undefined for a session that is not a seat of a known execution.
 */
export function squadWorkerVisibility(
  execution: ExecutionBoardProjection | undefined,
  slotId: string | undefined,
  now: number,
  staleAfterMs: number = STALE_HEARTBEAT_MS
): SquadWorkerVisibility | undefined {
  if (!execution || !slotId) return undefined;
  const owner = execution.startedFrom?.title?.trim();
  const base = { squad: execution.teamName?.trim() || execution.jobTitle, ...(owner ? { owner } : {}) };
  const claim = execution.work?.assignments.find((assignment) => assignment.slotId === slotId && assignment.state === 'CLAIMED');
  if (!claim) return { ...base, stale: false };
  const stamps = [claim.progressAt, claim.heartbeatAt, claim.claimedAt].filter((value): value is number => typeof value === 'number');
  const progressAt = claim.progressAt ?? claim.claimedAt;
  const heartbeatAgeMs = progressAt === undefined ? undefined : Math.max(0, now - progressAt);
  return {
    ...base,
    ...(stamps.length ? { lastActivityAt: Math.max(...stamps) } : {}),
    ...(heartbeatAgeMs === undefined ? {} : { heartbeatAgeMs }),
    turnCount: claim.turnCount ?? 0,
    stale: heartbeatAgeMs !== undefined && heartbeatAgeMs >= staleAfterMs
  };
}

/**
 * One line for the row: `<squad> · owner · active 2m ago · heartbeat 7m (stale) · 3 turns`.
 * Rows already grouped under their Squad's card pass `includeSquad: false` and `includeOwner: false`: the Squad name and
 * its owner are the same for every row, so the card shows the owner once instead.
 * The result is empty when nothing is left to say (a seat with no claim, no owner).
 */
export function squadWorkerVisibilityText(info: SquadWorkerVisibility, now: number, options: { includeSquad?: boolean; includeOwner?: boolean } = {}): string {
  const parts = options.includeSquad === false ? [] : [info.squad];
  if (info.owner && options.includeOwner !== false) parts.push(`owner ${info.owner}`);
  if (info.lastActivityAt !== undefined) parts.push(`active ${formatAge(now - info.lastActivityAt)} ago`);
  if (info.heartbeatAgeMs !== undefined) parts.push(`heartbeat ${formatAge(info.heartbeatAgeMs)}${info.stale ? ' (stale)' : ''}`);
  if (info.turnCount !== undefined) parts.push(`${info.turnCount} turn${info.turnCount === 1 ? '' : 's'}`);
  return parts.join(' · ');
}
