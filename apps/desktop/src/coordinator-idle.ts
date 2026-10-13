import type { CoordinatorHandoffContext } from './team-plan-handoff.js';

export interface OrchestratorIdleSession {
  projectId: string;
  cohort?: { executionId?: string; slotId?: string; role?: string };
}

export interface OrchestratorIdleDeps {
  drainCoordinatorWake(projectId: string, executionId: string, sessionId: string): Promise<void>;
  getExecution(projectId: string, executionId: string): Promise<{ squadWorktree?: { path: string } } | undefined>;
  projectPath(projectId: string): string | undefined;
  onCoordinatorIdle(ctx: CoordinatorHandoffContext): Promise<unknown>;
  logError(context: string, error: unknown): void;
}

/**
 * Durable-Squad orchestrator reached idle: retry its queued coordinator wake and
 * run the Flow B/C file handoff. Both calls are fire-and-forget; the returned
 * promises are only for callers (tests) that need to await them.
 */
export function onOrchestratorIdle(
  deps: OrchestratorIdleDeps,
  sessionId: string,
  session: OrchestratorIdleSession
): { wake: Promise<void>; handoff: Promise<unknown> } | undefined {
  if (!(session.cohort?.executionId && session.cohort.role === 'orchestrator')) return undefined;
  const wake = deps.drainCoordinatorWake(session.projectId, session.cohort.executionId, sessionId).catch((error) =>
    deps.logError(`execution coordinator wake ${sessionId}`, error)
  );
  // Flow B/C file handoff: read the coordinator-authored `.zana/` plan file
  // and register it host-side (no execution.* MCP). No-op for a Flow A
  // coordinator (its plan is already registered → isPlanless is false).
  const handoff = deps.getExecution(session.projectId, session.cohort.executionId).then((execution) => {
    const handoffRoot = execution?.squadWorktree?.path ?? deps.projectPath(session.projectId);
    const executionId = session.cohort?.executionId;
    const slotId = session.cohort?.slotId;
    if (!(handoffRoot && executionId && slotId)) return;
    return deps.onCoordinatorIdle({
      sessionId,
      projectId: session.projectId,
      projectRoot: handoffRoot,
      executionId,
      slotId
    });
  }).catch((error) => deps.logError(`team plan handoff ${sessionId}`, error));
  return { wake, handoff };
}
