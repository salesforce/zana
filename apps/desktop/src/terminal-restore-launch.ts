import type { CreateTerminalRequest, Result, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { RestoreCapability } from '@zana-ai/zcc-server/services/launch/restore-capability-store';
import {
  releaseSquadWorktreeFollowUp,
  squadWorktreeFollowUpExecution,
  withSquadWorktreeLifecycleLock
} from './squad-worktree-lifecycle.js';

/** Principal shape accepted by the host's launch seam (kept structural; host owns the real type). */
export interface RestoreLaunchPrincipal {
  kind: string;
  id: string;
}

/** Named form of `launchAuthorizedTerminal`'s positional arguments for a restore/reconnect. */
export interface RestoreLaunchInput {
  request: CreateTerminalRequest;
  principal: RestoreLaunchPrincipal;
  spawnOpts?: Record<string, unknown>;
  teamId?: string;
  legacyPersonaFacetCompatibility: boolean;
  followUpExecutionId?: string;
}

export interface FollowUpClaimOps {
  /** Rebuild the in-memory follow-up claim (host-owned, takes the lifecycle lock). */
  claim(capability: RestoreCapability): Promise<void>;
  /** Drop the claim for `sessionId` under `executionId`; must run under the lifecycle lock. */
  release(executionId: string, sessionId: string): Promise<void>;
  /** True when `sessionId` already holds a claim on `executionId`. */
  isClaimed(executionId: string, sessionId: string): boolean;
}

export interface CapabilityReservations {
  consume(id: string, reservationId: string): unknown;
  release(id: string, reservationId: string): unknown;
}

/** Default release/isClaimed bound to the shared squad worktree lifecycle registry. */
export const lifecycleClaimOps = (claim: FollowUpClaimOps['claim']): FollowUpClaimOps => ({
  claim,
  release: (executionId, sessionId) =>
    withSquadWorktreeLifecycleLock(executionId, async () => {
      releaseSquadWorktreeFollowUp(executionId, sessionId);
    }),
  isClaimed: (executionId, sessionId) => squadWorktreeFollowUpExecution(sessionId) === executionId
});

interface BaseOptions {
  capability: RestoreCapability;
  reservationId: string;
  reservations: CapabilityReservations;
  followUp: FollowUpClaimOps;
  launch(input: RestoreLaunchInput): Promise<Result<TerminalSession>>;
}

export interface RestoreLaunchOptions extends BaseOptions {
  resolveWorktree(request: CreateTerminalRequest): Promise<Result<CreateTerminalRequest>>;
  restorePrincipal(capability: RestoreCapability): RestoreLaunchPrincipal;
  isTeamWorkerRestore(request: CreateTerminalRequest): boolean;
}

export interface ReconnectLaunchOptions extends BaseOptions {
  legacy: boolean;
}

/**
 * Runs `attempt` with the capability's follow-up claim held. Any outcome other
 * than a successful launch (failure result, resolver rejection, throw) releases
 * both the reservation and the claim this attempt created, so a retry can
 * re-claim and the retained worktree is not stuck "in use" until restart.
 * A claim that was already live before the attempt (startup rebuild for a
 * surviving tmux session) is left untouched.
 */
async function withFollowUpClaim(
  opts: BaseOptions,
  attempt: () => Promise<Result<TerminalSession>>
): Promise<Result<TerminalSession>> {
  const { capability, reservationId, reservations, followUp } = opts;
  const executionId = capability.followUpExecutionId;
  const sessionId = capability.sessionId;
  const hadClaim = Boolean(executionId && sessionId && followUp.isClaimed(executionId, sessionId));
  let launched = false;
  const releaseAll = async (): Promise<void> => {
    reservations.release(capability.id, reservationId);
    if (executionId && sessionId && !hadClaim) await followUp.release(executionId, sessionId);
  };
  try {
    await followUp.claim(capability);
    const result = await attempt();
    if (result.ok) {
      launched = true;
      reservations.consume(capability.id, reservationId);
    }
    return result;
  } finally {
    if (!launched) await releaseAll();
  }
}

export function restoreCapabilityLaunch(opts: RestoreLaunchOptions): Promise<Result<TerminalSession>> {
  const { capability } = opts;
  return withFollowUpClaim(opts, async () => {
    const resolved = await opts.resolveWorktree(capability.request);
    if (!resolved.ok) return resolved;
    return opts.launch({
      request: resolved.value,
      principal: opts.restorePrincipal(capability),
      spawnOpts: capability.sessionId
        ? { preallocatedSessionId: capability.sessionId, retainWorktree: Boolean(capability.followUpExecutionId) }
        : undefined,
      teamId: capability.request.cohort?.teamId,
      legacyPersonaFacetCompatibility: opts.isTeamWorkerRestore(capability.request),
      followUpExecutionId: capability.followUpExecutionId
    });
  });
}

export function reconnectCapabilityLaunch(opts: ReconnectLaunchOptions): Promise<Result<TerminalSession>> {
  const { capability } = opts;
  return withFollowUpClaim(opts, () =>
    opts.launch({
      request: capability.request,
      principal: opts.legacy
        ? { kind: 'interactive-user', id: 'reconnect:legacy-confirmed' }
        : { kind: 'automation', id: `reconnect:${capability.id}` },
      spawnOpts: {
        reconnectTmuxId: capability.remoteTmuxId,
        resume: true,
        retainWorktree: Boolean(capability.followUpExecutionId)
      },
      legacyPersonaFacetCompatibility: false,
      followUpExecutionId: capability.followUpExecutionId
    })
  );
}
