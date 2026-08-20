import type { SquadBundleWorkflowMetadataV1, TeamLaunchAuthorizationInputSlot, TeamLaunchAuthorizationResult, TeamLaunchRequestInput } from '../../shared/types.js';
import { launchDigest } from '../launch/digest.js';
import type { ExecutionRecord, ResolvedModelSnapshotV1 } from './store.js';
import type { createExecutionStore } from './store.js';
import type { ExecutionArtifactRecord, createExecutionArtifactStore } from './artifact-store.js';
import { validateWorkflowPolicyResult, type WorkflowPolicyResultV1 } from './policy-result.js';
import { isResumeGrantTerminal, type createResumeGrantStore } from './resume-grant-store.js';

export interface SquadExecutionRequestV1 {
  version: 1;
  teamId: string;
  launchRequestId: string;
  jobTitle?: string;
  summary?: string;
  slots: TeamLaunchAuthorizationInputSlot[];
  policy?: TeamLaunchRequestInput['policy'];
  workflow?: SquadBundleWorkflowMetadataV1;
  resolvedModels?: ResolvedModelSnapshotV1[];
}

export interface ExecutionServiceDeps {
  store: ReturnType<typeof createExecutionStore>;
  artifacts: ReturnType<typeof createExecutionArtifactStore>;
  authorizeTeamLaunch: (
    callerPrincipalId: string,
    teamId: string,
    projectId: string,
    launchRequestId: string,
    policy: NonNullable<TeamLaunchRequestInput['policy']>,
    slots: TeamLaunchAuthorizationInputSlot[]
  ) => Promise<{ ok: true; value: TeamLaunchAuthorizationResult } | { ok: false; code: string; message: string }> | { ok: true; value: TeamLaunchAuthorizationResult } | { ok: false; code: string; message: string };
  launchTeam: (teamId: string, projectId: string, request: TeamLaunchRequestInput) => Promise<{ ok: boolean; code?: string; message?: string }>;
  getTeamLaunch: (callerPrincipalId: string, launchRequestId: string) => Promise<unknown>;
  cancelTeamLaunch: (callerPrincipalId: string, launchRequestId: string) => Promise<{
    ok: boolean;
    code?: string;
    message?: string;
    value?: { canceledSessionIds: string[]; pendingSessionIds: string[] };
  }>;
  replyToSession: (sessionId: string, text: string) => boolean;
  preflightWorkflow?: (teamId: string, workflow: SquadBundleWorkflowMetadataV1) => { ok: boolean; code?: string; message?: string };
  resumeGrants?: ReturnType<typeof createResumeGrantStore>;
  clearResumeToken?: (projectId: string, executionId: string) => void | Promise<void>;
}

export class SquadExecutionService {
  private readonly starting = new Map<string, number>();

  constructor(private readonly deps: ExecutionServiceDeps) {}

  async start(callerPrincipalId: string, projectId: string, request: SquadExecutionRequestV1): Promise<
    { ok: true; value: ExecutionRecord & { resumeToken?: string; resumeTokenExpiresAt?: number } } | { ok: false; code: string; message: string }
  > {
    if (request.version !== 1 || !request.teamId?.trim() || !request.launchRequestId?.trim() || !request.slots?.length) {
      return { ok: false, code: 'INVALID', message: 'invalid execution request' };
    }
    const jobTitle = deriveJobTitle(request);
    const summary = request.summary?.trim() || undefined;
    if (request.workflow) {
      const preflight = this.deps.preflightWorkflow?.(request.teamId, request.workflow);
      if (!preflight?.ok) return { ok: false, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message: preflight?.message ?? 'workflow profiles are unavailable' };
      if (!request.workflow.supportedRequestVersions.includes(request.version)) {
        return { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'workflow profile does not support this execution request version' };
      }
    }
    const resolvedModels = request.resolvedModels ?? [];
    if (!hasUniqueModelSlots(resolvedModels)) return { ok: false, code: 'INVALID', message: 'duplicate resolved model slot' };
    const startingKey = `${callerPrincipalId}:${request.launchRequestId}`;
    this.beginStarting(startingKey);
    let claim;
    try {
      claim = await this.deps.store.claim({
        callerPrincipalId, projectId, teamId: request.teamId, jobTitle, summary,
        launchRequestId: request.launchRequestId,
        request: { version: 1, slots: request.slots, policy: request.policy, workflow: request.workflow, resolvedModels },
        resolvedModels,
        requestDigest: launchDigest({ callerPrincipalId, projectId, request: { ...request, jobTitle, summary } })
      });
    } catch (error) {
      this.endStarting(startingKey);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
    this.endStarting(startingKey);
    if (claim.outcome === 'conflict') return { ok: false, code: 'CONFLICT', message: 'execution request id reused with changed input' };
    if (claim.outcome === 'replay') {
      const reconciled = await this.reconcile(callerPrincipalId, projectId, claim.record);
      if (reconciled.state === 'BLOCKED' || reconciled.state === 'FAILED') {
        return { ok: false, code: reconciled.state, message: `execution is ${reconciled.state.toLowerCase()}` };
      }
      return { ok: true, value: reconciled };
    }

    let record: ExecutionRecord;
    let resumeGrant: { token: string; expiresAt: number } | undefined;
    this.beginStarting(claim.record.id);
    try {
      if (this.deps.resumeGrants) {
        resumeGrant = await this.deps.resumeGrants.mint({ executionId: claim.record.id, projectId, callerPrincipalId });
      }
      record = await this.deps.store.transition(claim.record.id, claim.record.stateVersion, 'STARTING', 'info', 'Team launch authorized');
    } catch (error) {
      this.endStarting(claim.record.id);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (request.workflow) {
        const preflight = this.deps.preflightWorkflow?.(request.teamId, request.workflow);
        if (!preflight?.ok) {
          await this.transitionOrCurrent(record, 'BLOCKED', 'warning', preflight?.message ?? 'workflow profile is unavailable');
          return { ok: false, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message: preflight?.message ?? 'workflow profile is unavailable' };
        }
      }
      const authorization = await this.deps.authorizeTeamLaunch(
        callerPrincipalId, request.teamId, projectId, record.teamLaunchRequestId, request.policy ?? {}, request.slots
      );
        if (!authorization.ok) {
          await this.transitionOrCurrent(record, 'BLOCKED', 'warning', authorization.message);
          return { ok: false, code: authorization.code, message: authorization.message };
      }
        if (!authorization.value.context) {
          await this.transitionOrCurrent(record, 'BLOCKED', 'warning', 'Team authorization context unavailable');
          return { ok: false, code: 'AUTHORIZATION_CONTEXT_UNAVAILABLE', message: 'Team authorization context unavailable' };
      }
      record = await this.deps.store.setAuthorizationContext(
        record.id,
        record.stateVersion,
        authorization.value.context,
        launchDigest(authorization.value.context)
      );
      record = await this.deps.store.prepareLaunchIntent(record.id, record.stateVersion, {
        version: 1,
        authorizationContextDigest: record.authorizationContextDigest!,
        slots: authorization.value.slots.map(({ slotId, personaId, initialTask }) => ({
          slotId,
          personaId,
          initialTaskDigest: launchDigest(initialTask)
        }))
      });
      const launched = await this.deps.launchTeam(request.teamId, projectId, {
        callerPrincipalId, launchRequestId: record.teamLaunchRequestId, slots: authorization.value.slots,
        policy: request.policy, requirePreauthorization: true, executionId: record.id, executionJobTitle: record.jobTitle
      });
      if (!launched.ok) {
        await this.transitionOrCurrent(record, 'FAILED', 'error', launched.message ?? 'Team launch failed');
        return { ok: false, code: launched.code ?? 'TEAM_LAUNCH_FAILED', message: launched.message ?? 'Team launch failed' };
      }
      record = await this.transitionOrCurrent(record, 'RUNNING', 'info', 'Team launch started');
      return { ok: true, value: { ...record, ...(resumeGrant ? { resumeToken: resumeGrant.token, resumeTokenExpiresAt: resumeGrant.expiresAt } : {}) } };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const current = await this.failLaunch(record, `Team launch error: ${message}`);
      return current.state === 'FAILED'
        ? { ok: false, code: 'TEAM_LAUNCH_FAILED', message }
        : { ok: false, code: 'TEAM_LAUNCH_STATE_CONFLICT', message: `Team launch failed while execution is ${current.state.toLowerCase()}` };
    } finally {
      this.endStarting(claim.record.id);
    }
  }

  async status(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    return record ? this.reconcile(callerPrincipalId, projectId, record) : undefined;
  }

  async list(callerPrincipalId: string, projectId: string) {
    const records = await this.deps.store.list(callerPrincipalId, projectId);
    return Promise.all(records.map((record) => this.reconcile(callerPrincipalId, projectId, record)));
  }

  async events(callerPrincipalId: string, projectId: string, executionId: string, after = 0, limit = 100) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    return record ? this.deps.store.eventsInProject(projectId, executionId, after, limit) : { events: [] };
  }

  async reportEvent(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    input: Parameters<ExecutionServiceDeps['store']['producerEvent']>[1]
  ) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    try {
      return { ok: true as const, value: await this.deps.store.producerEvent(record.id, input) };
    } catch (error) {
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async retry(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    let retry: ExecutionRecord;
    this.beginStarting(record.id);
    try {
      retry = await this.deps.store.beginRetry(record.id, expectedStateVersion);
    } catch (error) {
      this.endStarting(record.id);
      if (error instanceof Error && error.message === 'stale execution state') {
        return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: await this.deps.store.get(record.id) };
      }
      return { ok: false as const, code: 'RETRY_NOT_ALLOWED', message: error instanceof Error ? error.message : String(error) };
    }
    const request = retry.request;
    try {
      if (request.workflow) {
        const preflight = this.deps.preflightWorkflow?.(retry.teamId, request.workflow);
        if (!preflight?.ok) {
          const blocked = await this.transitionOrCurrent(retry, 'BLOCKED', 'warning', preflight?.message ?? 'workflow profile is unavailable');
          return { ok: false as const, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message: preflight?.message ?? 'workflow profile is unavailable', value: blocked };
        }
      }
      const authorization = await this.deps.authorizeTeamLaunch(retry.callerPrincipalId, retry.teamId, projectId, retry.teamLaunchRequestId, request.policy ?? {}, request.slots);
      if (!authorization.ok || !authorization.value.context) {
        const blocked = await this.transitionOrCurrent(retry, 'BLOCKED', 'warning', authorization.ok ? 'Team authorization context unavailable' : authorization.message);
        return { ok: false as const, code: authorization.ok ? 'AUTHORIZATION_CONTEXT_UNAVAILABLE' : authorization.code, message: authorization.ok ? 'Team authorization context unavailable' : authorization.message, value: blocked };
      }
      let current = await this.deps.store.setAuthorizationContext(retry.id, retry.stateVersion, authorization.value.context, launchDigest(authorization.value.context));
      current = await this.deps.store.prepareLaunchIntent(current.id, current.stateVersion, {
        version: 1, authorizationContextDigest: current.authorizationContextDigest!,
        slots: authorization.value.slots.map(({ slotId, personaId, initialTask }) => ({ slotId, personaId, initialTaskDigest: launchDigest(initialTask) }))
      });
      const launched = await this.deps.launchTeam(retry.teamId, projectId, { callerPrincipalId: retry.callerPrincipalId, launchRequestId: retry.teamLaunchRequestId, slots: authorization.value.slots, policy: request.policy, requirePreauthorization: true, executionId: retry.id, executionJobTitle: retry.jobTitle });
      if (!launched.ok) {
        const failed = await this.failLaunch(current, launched.message ?? 'Team launch failed');
        return { ok: false as const, code: launched.code ?? 'TEAM_LAUNCH_FAILED', message: launched.message ?? 'Team launch failed', value: failed };
      }
      return { ok: true as const, value: await this.transitionOrCurrent(current, 'RUNNING', 'info', 'Team retry launch started') };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false as const, code: 'TEAM_LAUNCH_FAILED', message, value: await this.failLaunch(retry, `Team retry launch error: ${message}`) };
    } finally {
      this.endStarting(record.id);
    }
  }

  async putArtifact(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    name: string,
    mediaType: string,
    content: string
  ): Promise<{ ok: true; value: ExecutionArtifactRecord } | { ok: false; code: string; message: string }> {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for caller' };
    if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    }
    try {
      const artifact = await this.deps.artifacts.put({
        executionId: record.id, attempt: record.attempt, projectId, name, mediaType, content
      });
      if (artifact.outcome === 'conflict') return { ok: false, code: 'CONFLICT', message: 'artifact name already has different content' };
      await this.emitOrCurrent(record, 'info', `Artifact recorded: ${artifact.record.name}`);
      return { ok: true, value: artifact.record };
    } catch (error) {
      return { ok: false, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async listArtifacts(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    return record ? this.deps.artifacts.list(record.id, projectId) : undefined;
  }

  /** Trusted main-side policy evaluator entrypoint. Never expose through session MCP. */
  async recordPolicyResult(projectId: string, executionId: string, raw: unknown) {
    const record = await this.deps.store.get(executionId);
    if (record?.projectId !== projectId) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for project' };
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    const result = validateWorkflowPolicyResult(raw);
    if (!result || result.executionId !== record.id || result.attempt !== record.attempt) {
      return { ok: false as const, code: 'INVALID', message: 'policy result does not bind this execution attempt' };
    }
    try {
      const updated = await this.deps.store.setPolicyResult(record.id, record.stateVersion, result);
      return { ok: true as const, value: updated };
    } catch (error) {
      return { ok: false as const, code: 'CONFLICT', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async stop(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    return this.stopOwned(record, expectedStateVersion);
  }

  async respond(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, slotId: string, response: string) {
    return this.deliver(callerPrincipalId, projectId, executionId, expectedStateVersion, slotId, response, false);
  }

  async resume(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, slotId: string, message: string) {
    return this.deliver(callerPrincipalId, projectId, executionId, expectedStateVersion, slotId, message, true);
  }

  /** Caller validated a consumed handoff; source owner remains bound for lifecycle work. */
  async controlWithHandoff(
    authority: { sourceOwnerSessionId: string; projectId: string; executionId: string },
    action: 'stop' | 'respond' | 'resume',
    expectedStateVersion: number,
    slotId?: string,
    message?: string
  ) {
    const record = await this.getAuthorized(authority.sourceOwnerSessionId, authority.projectId, authority.executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution handoff no longer matches an execution owner' };
    if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    }
    if (action === 'stop') return this.stopOwned(record, expectedStateVersion);
    if (!slotId || !message) return { ok: false as const, code: 'INVALID', message: 'execution handoff requires slotId and message' };
    return this.deliverOwned(record, expectedStateVersion, slotId, message, action === 'resume');
  }

  private async getAuthorized(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.deps.store.get(executionId);
    return record && record.callerPrincipalId === callerPrincipalId && record.projectId === projectId ? record : undefined;
  }

  private async getAuthorizedForControl(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.deps.store.get(executionId);
    return record && record.projectId === projectId
      && (record.callerPrincipalId === callerPrincipalId || record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId)) ? record : undefined;
  }

  async resumeBinding(callerPrincipalId: string, projectId: string, executionId: string, token: string) {
    const record = await this.deps.store.getInProject(projectId, executionId);
    if (!record || isResumeGrantTerminal(record.state) || !this.deps.resumeGrants) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'execution resume grant is not current' };
    }
    try {
      await this.deps.resumeGrants.consume({ token, executionId, projectId, effectiveOwnerPrincipalId: callerPrincipalId });
      return { ok: true as const, value: await this.deps.store.addEffectiveOwner(executionId, callerPrincipalId) };
    } catch (error) {
      if (error instanceof Error && error.message === 'execution resume grant is not current') {
        return { ok: false as const, code: 'NOT_FOUND', message: error.message };
      }
      return { ok: false as const, code: 'BINDING_TRANSIENT', message: 'execution resume binding could not be persisted; retry with the same token' };
    }
  }

  async mintResumeGrant(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorized(callerPrincipalId, projectId, executionId);
    if (!record || !this.deps.resumeGrants || isResumeGrantTerminal(record.state)) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'execution resume grant is not current' };
    }
    try {
      return { ok: true as const, value: await this.deps.resumeGrants.mint({ executionId, projectId, callerPrincipalId }) };
    } catch (error) {
      return { ok: false as const, code: 'MINT_TRANSIENT', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async revokeResumeGrant(callerPrincipalId: string, projectId: string, executionId: string, effectiveOwnerPrincipalId?: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record || !this.deps.resumeGrants) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    await this.deps.resumeGrants.revoke(executionId, projectId);
    const value = effectiveOwnerPrincipalId ? await this.deps.store.removeEffectiveOwner(executionId, effectiveOwnerPrincipalId) : record;
    return { ok: true as const, value };
  }

  private async deliver(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    expectedStateVersion: number,
    slotId: string,
    text: string,
    resume: boolean
  ) {
    if (!slotId.trim() || !text.trim() || text.length > 64 * 1024) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution slot or message' };
    }
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    return this.deliverOwned(record, expectedStateVersion, slotId, text, resume);
  }

  private async deliverOwned(record: ExecutionRecord, expectedStateVersion: number, slotId: string, text: string, resume: boolean) {
    if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    }
    const fenced = await this.fenceCommand(record, expectedStateVersion, resume ? 'Execution resume requested' : 'Execution response requested', slotId);
    if (!fenced.ok) return fenced;
    const lifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, fenced.value.launchRequestId) as {
      workers?: Array<{ slotId?: string; sessionId?: string; projectId?: string }>;
    } | undefined;
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
    if (!worker?.sessionId) return { ok: false as const, code: 'NOT_FOUND', message: 'execution slot not found for caller' };
    if (!this.deps.replyToSession(worker.sessionId, text)) {
      await this.emitOrCurrent(record, 'warning', `Message not delivered: slot ${slotId} is no longer live`);
      return { ok: false as const, code: 'SESSION_GONE', message: 'execution slot is no longer live' };
    }
    let current = fenced.value;
    if (resume && fenced.value.state === 'BLOCKED') {
      current = await this.transitionOrCurrent(fenced.value, 'RUNNING', 'info', `Execution resumed through slot ${slotId}`);
    } else {
      current = await this.emitOrCurrent(record, 'info', `Message delivered to slot ${slotId}`);
    }
    return { ok: true as const, value: current };
  }

  private async stopOwned(record: ExecutionRecord, expectedStateVersion: number) {
    if (record.state === 'COMPLETED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is already ${record.state.toLowerCase()}` };
    }
    const fenced = await this.fenceCommand(record, expectedStateVersion, 'Execution stop requested');
    if (!fenced.ok) return fenced;
    const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, fenced.value.launchRequestId);
    if (!canceled.ok) return { ok: false as const, code: canceled.code ?? 'CANCEL_FAILED', message: canceled.message ?? 'Team cancellation failed' };
    if (fenced.value.state === 'FAILED') {
      const current = await this.emitOrCurrent(fenced.value, 'info', 'Stop requested for surviving partial-launch slots');
      return { ok: true as const, value: current, canceled: canceled.value };
    }
    const stopped = await this.transitionOrCurrent(fenced.value, 'STOPPED', 'info', 'Execution stopped');
    return { ok: true as const, value: stopped, canceled: canceled.value };
  }

  private async fenceCommand(record: ExecutionRecord, expectedStateVersion: number, summary: string, slotId?: string) {
    try {
      return { ok: true as const, value: await this.deps.store.command(record.id, expectedStateVersion, summary, slotId) };
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') {
        const current = await this.deps.store.get(record.id);
        return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current };
      }
      throw error;
    }
  }

  private async reconcile(callerPrincipalId: string, projectId: string, record: ExecutionRecord): Promise<ExecutionRecord> {
    if (record.state === 'READY') return record;
    let lifecycle: {
      workers?: Array<{ projectId?: string; task?: string; process?: string }>;
      launchResult?: { failedSlots?: unknown[] };
      outcome?: { status?: string; result?: { ok?: boolean; message?: string } };
    } | undefined;
    try {
      lifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.launchRequestId) as typeof lifecycle;
    } catch {
      // A transient lifecycle read must not turn an active execution into a
      // durable blocker during status/list polling.
      return record;
    }
    if (!lifecycle || !Array.isArray(lifecycle.workers) || lifecycle.workers.some((worker) => worker.projectId !== projectId)) {
      if (record.state === 'STARTING' && this.starting.has(record.id)) return record;
      if (record.state === 'BLOCKED' || record.state === 'COMPLETED' || record.state === 'STOPPED' || record.state === 'FAILED') return record;
      return this.transitionOrCurrent(record, 'BLOCKED', 'warning', 'Team lifecycle record unavailable or mismatched');
    }
    if (record.state !== 'RUNNING' && record.state !== 'STARTING') return record;
    if (lifecycle.launchResult?.failedSlots?.length) {
      return this.transitionOrCurrent(record, 'FAILED', 'error', 'One or more Team slots failed to launch');
    }
    if (lifecycle.outcome?.status === 'completed' && lifecycle.outcome.result?.ok === false) {
      return this.transitionOrCurrent(record, 'FAILED', 'error', lifecycle.outcome.result.message ?? 'Team launch failed');
    }
    if (lifecycle.workers.length > 0 && lifecycle.workers.every((worker) => worker.task === 'caller-reported-complete')) {
      return this.transitionOrCurrent(record, 'COMPLETED', 'info', 'All Team slots reported complete');
    }
    if (lifecycle.workers.some((worker) => worker.task === 'caller-reported-failed')) {
      return this.transitionOrCurrent(record, 'FAILED', 'error', 'A Team slot reported failure');
    }
    if (lifecycle.workers.length > 0 && lifecycle.workers.every((worker) =>
      worker.process === 'exited' || worker.process === 'spawn-failed' || worker.process === 'canceled')) {
      return this.transitionOrCurrent(record, 'FAILED', 'error', 'All Team slots exited without completion');
    }
    if (record.state === 'STARTING' && lifecycle.workers.some((worker) => worker.process !== 'exited' && worker.process !== 'spawn-failed' && worker.process !== 'canceled')) {
      return this.transitionOrCurrent(record, 'RUNNING', 'info', 'Team launch recovered from lifecycle record');
    }
    return record;
  }

  private async transitionOrCurrent(
    record: ExecutionRecord,
    state: ExecutionRecord['state'],
    severity: 'info' | 'warning' | 'error',
    summary: string
  ): Promise<ExecutionRecord> {
    try {
      const updated = await this.deps.store.transition(record.id, record.stateVersion, state, severity, summary);
      if (isResumeGrantTerminal(updated.state)) await this.cleanupTerminal(updated);
      return updated;
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(record.id);
      if (!current) throw error;
      return current;
    }
  }

  private beginStarting(executionId: string): void {
    this.starting.set(executionId, (this.starting.get(executionId) ?? 0) + 1);
  }

  private endStarting(executionId: string): void {
    const count = this.starting.get(executionId) ?? 0;
    if (count <= 1) this.starting.delete(executionId);
    else this.starting.set(executionId, count - 1);
  }

  private async failLaunch(record: ExecutionRecord, summary: string): Promise<ExecutionRecord> {
    let current = record;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (current.state !== 'STARTING' && current.state !== 'RUNNING') return current;
      try {
        const failed = await this.deps.store.transition(current.id, current.stateVersion, 'FAILED', 'error', summary);
        await this.cleanupTerminal(failed);
        return failed;
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
        const refreshed = await this.deps.store.get(current.id);
        if (!refreshed) throw error;
        current = refreshed;
      }
    }
    return current;
  }

  private async emitOrCurrent(record: ExecutionRecord, severity: 'info' | 'warning' | 'error', summary: string): Promise<ExecutionRecord> {
    try {
      return await this.deps.store.event(record.id, record.stateVersion, severity, summary);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(record.id);
      if (!current) throw error;
      return current;
    }
  }

  private async cleanupTerminal(record: ExecutionRecord): Promise<void> {
    await this.deps.resumeGrants?.revoke(record.id, record.projectId);
    try {
      await this.deps.clearResumeToken?.(record.projectId, record.id);
    } catch {
      // Token cleanup is best effort; durable grant revocation already closes authority.
    }
  }
}

export function deriveJobTitle(request: Pick<SquadExecutionRequestV1, 'jobTitle' | 'summary' | 'teamId'>): string {
  const supplied = request.jobTitle?.trim();
  if (supplied) return supplied.slice(0, 240);
  const summary = request.summary?.split('\n', 1)[0]?.trim();
  return (summary || request.teamId).slice(0, 240);
}

function hasUniqueModelSlots(models: readonly ResolvedModelSnapshotV1[]): boolean {
  const slots = new Set<string>();
  for (const model of models) {
    if (!model.slotId?.trim() || !model.provider?.trim() || !model.model?.trim() || slots.has(model.slotId)) return false;
    slots.add(model.slotId);
  }
  return true;
}
