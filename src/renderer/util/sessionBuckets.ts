import type { AgentState, TerminalSession } from '../../shared/types.js';

/**
 * How long a finished (exited) agent lingers in the "Recently finished" /
 * "Done" lists before it's auto-dismissed. After this window it drops out of
 * those lists so they don't accumulate dead tombstones — the per-second tick in
 * the Agents view / board re-renders and the row disappears on its own.
 */
export const FINISHED_LINGER_MS = 60_000;

/**
 * True for an exited session that finished within the last
 * {@link FINISHED_LINGER_MS}. Drives the finished-list auto-dismiss. A live
 * session is never "recently finished". An exited session with no `finishedAt`
 * stamp (shouldn't happen — store.ts stamps it on exit) counts as recent so a
 * missing timestamp never hides it prematurely.
 */
export function isRecentlyFinished(session: TerminalSession, now: number): boolean {
  if (session.status !== 'exited') return false;
  if (typeof session.finishedAt !== 'number') return true;
  return now - session.finishedAt <= FINISHED_LINGER_MS;
}

/**
 * Status bucket a session is sorted into for Project Focus Mode. Ordering of
 * the union mirrors the display order (most-urgent first), but the canonical
 * order lives in {@link BUCKET_ORDER} — don't rely on union order at runtime.
 */
export type SessionBucketId =
  | 'blocked' // "Needs you" — agent waiting on the user
  | 'running' // working agents
  | 'done' // finished its turn, unseen
  | 'idle' // at the prompt, seen
  | 'shell' // plain shells (no agent) — kept apart from the agent buckets
  | 'exited'; // pty closed (crashed sorts first within)

export interface SessionBucket {
  id: SessionBucketId;
  label: string;
  sessions: TerminalSession[];
}

/** Display order — most-urgent first. Also the source of bucket labels.
 *  Shells sit below the agent buckets (they carry no agent state to rank) but
 *  above Exited. */
const BUCKET_ORDER: { id: SessionBucketId; label: string }[] = [
  { id: 'blocked', label: 'Needs you' },
  { id: 'running', label: 'Running' },
  { id: 'done', label: 'Done' },
  { id: 'idle', label: 'Idle' },
  { id: 'shell', label: 'Shells' },
  { id: 'exited', label: 'Exited' }
];

/**
 * Classify a single session into its bucket. Rules are applied in order:
 *  1. exited pty → exited (regardless of profile / agent state).
 *  2. plain shells (the `shell` profile) → shell. Shells carry no agent state,
 *     so they'd otherwise masquerade as "running" agents — keep them apart.
 *  3. else by live agent state (default 'unknown' when absent):
 *     blocked → blocked, working → running, done → done, idle → idle,
 *     unknown → running if the pty is running, else idle.
 *
 * Hidden (headless) sessions are NOT a bucket of their own — closing a tab
 * keeps the session alive and listed under its real status, so it sorts by
 * agent state just like a visible tab. Clicking its row re-opens it.
 */
function classify(session: TerminalSession, agent: AgentState): SessionBucketId {
  if (session.status === 'exited') return 'exited';
  if (session.profile === 'shell') return 'shell';
  switch (agent) {
    case 'blocked':
      return 'blocked';
    case 'working':
      return 'running';
    case 'done':
      return 'done';
    case 'idle':
      return 'idle';
    case 'unknown':
    default:
      return session.status === 'running' ? 'running' : 'idle';
  }
}

/**
 * Pure function: partition a project's sessions into ordered, status-grouped
 * buckets for the focus-mode column. No store access, no side effects.
 *
 * - Returns buckets in {@link BUCKET_ORDER} (most-urgent first).
 * - Omits empty buckets — only headers with ≥1 session appear.
 * - Preserves input order of sessions within a bucket, except the exited
 *   bucket, where crashed sessions (non-zero exitCode) sort before clean exits.
 */
export function bucketSessions(
  sessions: TerminalSession[],
  agentById: Record<string, AgentState>
): SessionBucket[] {
  const byBucket: Record<SessionBucketId, TerminalSession[]> = {
    blocked: [],
    running: [],
    done: [],
    idle: [],
    shell: [],
    exited: []
  };

  for (const session of sessions) {
    // Scheduler-spawned jobs are surfaced via the inbox, not the user's
    // session list — keep them out of the buckets entirely.
    if (session.scheduled) continue;
    const agent = agentById[session.id] ?? 'unknown';
    byBucket[classify(session, agent)].push(session);
  }

  // Within exited: crashed (non-zero exitCode) first, clean exits after.
  // Stable so input order is preserved within each crashed/clean partition.
  const crashed = (s: TerminalSession) =>
    typeof s.exitCode === 'number' && s.exitCode !== 0;
  byBucket.exited.sort((a, b) => Number(crashed(b)) - Number(crashed(a)));

  return BUCKET_ORDER.filter(({ id }) => byBucket[id].length > 0).map(
    ({ id, label }) => ({ id, label, sessions: byBucket[id] })
  );
}
