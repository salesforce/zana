import type { ConversationThreadRow } from '@zana-ai/zcc-db';

/**
 * Liveness predicate for a Modern/ACP conversation thread acting as an owner
 * launcher: a non-archived thread still usable in the asserted project. Idle
 * is rest between turns, not death — `doc-execute` and later owner verbs fire
 * after the first turn settles.
 *
 * `error` is ALSO live here, and this is load-bearing: `error` is set by a
 * `turn/failed` host event (conversation-host-event-status.ts) and reflects one
 * PAST turn that failed — it is NOT thread death. The user keeps chatting in an
 * errored thread (the composer stays enabled) and the agent runs fresh turns,
 * so the owner MUST still be allowed to launch. Treating `error` as dead
 * silently and PERMANENTLY locked an errored owner thread out of
 * `execution.start` / `launch_team` (surfaced as "session MCP is not authorized
 * for this live session"), even mid-active-turn when the current turn's
 * `active` write races behind the loopback tool-call's identity read — the real
 * failure the fresh-thread E2E/live fixtures never hit (they never fail a turn).
 * Only ARCHIVAL (explicit end), a missing row, or a different project mean dead.
 * Pure — the `thread-live` server-runtime handler wraps it (and Electron-main
 * uses it, via `runtimeSupervisor.isThreadLive`, as the ACP half of
 * owner-session identity). Cohort / worker verbs stay pty-only.
 */
export function isThreadLiveInProject(
  row: ConversationThreadRow | null | undefined,
  projectId: string
): boolean {
  return (
    !!row &&
    row.archivedAt === null &&
    row.projectId === projectId &&
    (row.status === 'starting' || row.status === 'active' || row.status === 'idle'
      || row.status === 'stopping' || row.status === 'error')
  );
}
