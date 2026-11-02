import type { RestoreCapability } from '@zana-ai/zcc-server/services/launch/restore-capability-store';
import type { ExecutionNativeRecoverySnapshotV1, ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import { isResumableExecutionState } from '@zana-ai/zcc-server/services/execution/storage/backend-policy';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { isTerminalSquadExecution } from './inbox-actions/squad-instruct.js';
import {
  releaseSquadWorktreeFollowUp,
  restoreSquadWorktreeFollowUp,
  squadWorktreeFollowUpExecution,
  withSquadWorktreeLifecycleLock,
  type SquadWorktreeTerminalOutcome
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

export interface ModernNativeRecoveryCaptureDeps {
  executionStore: {
    getInProject(projectId: string, executionId: string): Promise<ExecutionRecord | undefined>;
    upsertNativeRecoverySnapshot(executionId: string, stateVersion: number, snapshot: Omit<ExecutionNativeRecoverySnapshotV1, 'version' | 'capturedAt'>): Promise<unknown>;
  };
  logError(context: string, error: unknown): void;
}

export interface ModernNativeRecoveryMember {
  projectId: string;
  executionId: string;
  slotId: string;
  role: 'worker' | 'orchestrator';
  personaId: string;
  profileId: string;
  threadId: string;
  generation: number;
  providerId: string;
  hostId: string;
  environmentPath: string;
}

/** Runtime evidence for one member: only the fields capture reads. */
export interface ModernNativeRecoveryStatus {
  generation: number;
  providerThreadId?: string;
  sessionRestorable?: boolean;
}

/**
 * Persist a Modern (ACP) squad member's provider session so a stopped squad can
 * later be resumed. Mirrors the CLI capture: written while the execution is
 * still live and never after it is terminal (the store would reject a stale
 * attempt anyway). Callers invoke it while the member is live, immediately before
 * a stop request, and again after a confirmed stop; the first writes the
 * snapshot, later calls are deduplicated or fall to the terminal guard.
 * Only members whose start reported `sessionRestorable === true` are captured.
 */
export function createModernNativeRecoveryCapture(deps: ModernNativeRecoveryCaptureDeps) {
  return async function captureModernNativeRecoverySnapshot(
    member: ModernNativeRecoveryMember, status: ModernNativeRecoveryStatus | undefined
  ): Promise<boolean> {
    if (!status || status.sessionRestorable !== true || !status.providerThreadId
      || status.generation !== member.generation || member.generation < 1) return false;
    const providerThreadId = status.providerThreadId;
    try {
      const record = await deps.executionStore.getInProject(member.projectId, member.executionId);
      if (!record || record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') return false;
      const existing = record.nativeRecoverySnapshots?.find((snapshot) => snapshot.slotId === member.slotId);
      if (existing?.attempt === record.attempt && existing.transport === 'MODERN' && existing.threadId === member.threadId
        && existing.generation === member.generation && existing.nativeConversationId === providerThreadId) return false;
      await deps.executionStore.upsertNativeRecoverySnapshot(record.id, record.stateVersion, {
        attempt: record.attempt, slotId: member.slotId, role: member.role, personaId: member.personaId,
        profileId: member.profileId, nativeConversationId: providerThreadId, transport: 'MODERN',
        threadId: member.threadId, generation: member.generation, providerThreadId, providerId: member.providerId,
        environmentPath: member.environmentPath, hostId: member.hostId
      });
      return true;
    } catch (error) {
      deps.logError(`execution modern native recovery snapshot ${member.threadId}`, error);
      return false;
    }
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
  handleSquadWorktreeTerminal(record: ExecutionRecord): Promise<SquadWorktreeTerminalOutcome | undefined>;
  teamPlanHandoff: { forget(executionId: string): void };
  inferredPlanCorrection: { forget(executionId: string): void };
  projects: { listProjects(): Array<{ id: string; path: string }> };
  cleanupHandoffFiles(projectRoot: string, executionId: string, options?: { keepAuthoredPlan?: boolean }): Promise<unknown>;
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
 * A planless run that a retry or recovery can still relaunch keeps the authored
 * plan: every attempt reads the same per-execution file, so deleting it here left
 * the next coordinator with "no plan file found" for a plan it had written.
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
    if (handoffRoot) return deps.cleanupHandoffFiles(handoffRoot, executionId, { keepAuthoredPlan: mayRelaunchPlanless(execution) });
  }).then(() => undefined).catch(() => {});
}

/** Still planless, not superseded, and in a state retry or recovery may relaunch. */
function mayRelaunchPlanless(execution: ExecutionRecord | undefined): boolean {
  return !!execution && !execution.workUnits?.length && !execution.successorExecutionId && isResumableExecutionState(execution);
}
