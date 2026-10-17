import type { RestoreCapability } from '@zana-ai/zcc-server/services/launch/restore-capability-store';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { isTerminalSquadExecution } from './inbox-actions/squad-instruct.js';
import {
  releaseSquadWorktreeFollowUp,
  restoreSquadWorktreeFollowUp,
  squadWorktreeFollowUpExecution,
  withSquadWorktreeLifecycleLock
} from './squad-worktree-lifecycle.js';

type RestoreCapabilities = {
  list(): RestoreCapability[];
  findSession(sessionId: string): RestoreCapability | undefined;
  put(capability: RestoreCapability): unknown;
};

export interface FollowUpClaimDeps {
  restoreCapabilities: RestoreCapabilities;
  listLiveSessionIds(): Promise<Iterable<string>>;
}

/**
 * Durable ownership of a retained Squad worktree by a normal follow-up agent.
 * The claim is rebuilt from restore capabilities at boot and on renderer reattach,
 * and released only on PtyManager's confirmed exit.
 */
export function createFollowUpClaims(deps: FollowUpClaimDeps) {
  async function restoreClaim(capability: RestoreCapability): Promise<void> {
    const { followUpExecutionId, sessionId } = capability;
    if (!followUpExecutionId || !sessionId) return;
    await withSquadWorktreeLifecycleLock(followUpExecutionId, async () => {
      restoreSquadWorktreeFollowUp(followUpExecutionId, sessionId);
    });
  }

  async function restoreSurvivingClaims(): Promise<void> {
    const liveSessionIds = new Set(await deps.listLiveSessionIds());
    await Promise.all(deps.restoreCapabilities.list()
      .filter((capability) => capability.sessionId && liveSessionIds.has(capability.sessionId))
      .map((capability) => restoreClaim(capability)));
  }

  function clearClaim(sessionId: string): void {
    const capability = deps.restoreCapabilities.findSession(sessionId);
    if (!capability?.followUpExecutionId) return;
    deps.restoreCapabilities.put({ ...capability, followUpExecutionId: undefined });
  }

  /** Confirmed-exit release. Returns the lifecycle-locked promise for callers that await it. */
  function releaseOnExit(sessionId: string): Promise<void> | undefined {
    const followUpExecutionId = squadWorktreeFollowUpExecution(sessionId);
    if (!followUpExecutionId) return undefined;
    return withSquadWorktreeLifecycleLock(followUpExecutionId, async () => {
      releaseSquadWorktreeFollowUp(followUpExecutionId, sessionId);
      clearClaim(sessionId);
    });
  }

  return { restoreClaim, restoreSurvivingClaims, clearClaim, releaseOnExit };
}

export interface NativeRecoveryCaptureDeps {
  executionStore: {
    getInProject(projectId: string, executionId: string): Promise<ExecutionRecord | undefined>;
    upsertNativeRecoverySnapshot(executionId: string, stateVersion: number, snapshot: {
      attempt: number;
      slotId: string;
      role: 'worker' | 'orchestrator';
      personaId: string;
      profileId: string;
      nativeConversationId: string;
    }): Promise<unknown>;
  };
  nativeConversationIdFor(session: TerminalSession): string | undefined;
  logError(context: string, error: unknown): void;
}

/**
 * Persist the provider-native conversation id of a live Squad slot so an exact
 * native recovery can later resume it. Native ids never leave main.
 */
export function createNativeRecoveryCapture(deps: NativeRecoveryCaptureDeps) {
  return function captureNativeRecoverySnapshot(session: TerminalSession): void {
    const cohort = session.cohort;
    if (!cohort?.executionId || !cohort.slotId || (cohort.role !== 'worker' && cohort.role !== 'orchestrator')) return;
    const nativeConversationId = deps.nativeConversationIdFor(session);
    if (!nativeConversationId || !session.personaId) return;
    const snapshotInput = {
      slotId: cohort.slotId,
      role: cohort.role === 'worker' ? 'worker' as const : 'orchestrator' as const,
      personaId: session.personaId,
      profileId: cohort.configuredProfile ?? session.profile,
      nativeConversationId
    };
    void deps.executionStore.getInProject(session.projectId, cohort.executionId).then((record) => {
      if (!record || record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') return;
      const existing = record.nativeRecoverySnapshots?.find((snapshot) => snapshot.slotId === snapshotInput.slotId);
      if (existing?.attempt === record.attempt && existing.nativeConversationId === nativeConversationId
        && existing.personaId === snapshotInput.personaId && existing.profileId === snapshotInput.profileId) return;
      return deps.executionStore.upsertNativeRecoverySnapshot(record.id, record.stateVersion, {
        attempt: record.attempt, ...snapshotInput
      });
    }).catch((error) => deps.logError(`execution native recovery snapshot ${session.id}`, error));
  };
}

export interface ExitedSquadSession {
  projectId: string;
  cohort?: { executionId?: string; role?: string };
}

export interface SessionExitTeardownDeps {
  executionStore: {
    get(executionId: string): Promise<ExecutionRecord | undefined>;
    getInProject(projectId: string, executionId: string): Promise<ExecutionRecord | undefined>;
  };
  handleSquadWorktreeTerminal(record: ExecutionRecord): Promise<unknown>;
  teamPlanHandoff: { forget(executionId: string): void };
  inferredPlanCorrection: { forget(executionId: string): void };
  projects: { listProjects(): Array<{ id: string; path: string }> };
  cleanupHandoffFiles(projectRoot: string, executionId: string): Promise<unknown>;
  logError(context: string, error: unknown): void;
}

/** Apply the retained-worktree terminal policy once an exiting session's execution is terminal. */
export async function teardownTerminalExecutionOnExit(
  deps: SessionExitTeardownDeps,
  exitedSession: ExitedSquadSession | null | undefined
): Promise<void> {
  const exitedExecutionId = exitedSession?.cohort?.executionId;
  if (!exitedExecutionId) return;
  const record = await deps.executionStore.get(exitedExecutionId);
  if (record?.squadWorktree && isTerminalSquadExecution(record.state)) {
    await deps.handleSquadWorktreeTerminal(record).catch((error) =>
      deps.logError(`execution terminal teardown ${exitedExecutionId}`, error)
    );
  }
}

/**
 * Coordinator exit: release Flow B/C plan-handoff state and remove the transient
 * `.zana/` handoff files from the worktree that actually held them (Rule 3 / Rule 5).
 */
export function cleanupOrchestratorOnExit(
  deps: SessionExitTeardownDeps,
  exitedSession: ExitedSquadSession | null | undefined
): Promise<void> | undefined {
  const executionId = exitedSession?.cohort?.executionId;
  if (!(exitedSession?.cohort?.role === 'orchestrator' && executionId)) return undefined;
  deps.teamPlanHandoff.forget(executionId);
  deps.inferredPlanCorrection.forget(executionId);
  return deps.executionStore.getInProject(exitedSession.projectId, executionId).then((execution) => {
    const handoffRoot = execution?.squadWorktree?.path ?? deps.projects.listProjects().find((candidate) => candidate.id === exitedSession.projectId)?.path;
    if (handoffRoot) return deps.cleanupHandoffFiles(handoffRoot, executionId);
  }).then(() => undefined).catch(() => {});
}
