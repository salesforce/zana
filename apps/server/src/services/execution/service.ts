import type { ExecutionSourceSnapshot, SquadBundleWorkflowMetadataV1, TeamLaunchAuthorizationInputSlot, TeamLaunchAuthorizationResult, TeamLaunchRequestInput } from '@zana-ai/zcc-domain/product';
import { launchDigest } from '../launch/digest.js';
import { EXECUTION_RETENTION_MS, type ExecutionCohortAuthority, type ExecutionLaunchDisplayV1, type ExecutionLaunchKind, type ExecutionRecord, type ExecutionWorkUnitInput, type ResolvedModelSnapshotV1 } from './store.js';
import type { createExecutionStore } from './store.js';
import type { ExecutionArtifactRecord, createExecutionArtifactStore } from './artifact-store.js';
import { validateWorkflowPolicyResult, type WorkflowPolicyResultV1 } from './policy-result.js';
import { isResumeGrantTerminal, type createResumeGrantStore } from './resume-grant-store.js';
import type { createExecutionSourceRegistry } from './source-registry.js';
import { buildInboxQuestion } from '../inbox/inbox-question-schema.js';
import { ExecutionDeadlineWatchdog } from './deadline-watchdog.js';

export interface ExecutionCohortBinding extends ExecutionCohortAuthority {
  executionId: string;
  projectId: string;
  principalId?: string;
  authorizationId?: string;
}

export interface ExecutionRequestV1 {
  version: 1;
  /** Omitted by legacy callers; current Team backend is default. */
  launchKind?: ExecutionLaunchKind;
  launchDisplay?: ExecutionLaunchDisplayV1;
  teamId: string;
  launchRequestId: string;
  jobTitle?: string;
  goal?: string;
  summary?: string;
  slots: TeamLaunchAuthorizationInputSlot[];
  policy?: TeamLaunchRequestInput['policy'];
  workflow?: SquadBundleWorkflowMetadataV1;
  resolvedModels?: ResolvedModelSnapshotV1[];
  sourceBundle?: {
    contentRef: string;
    sources: Array<Omit<ExecutionSourceSnapshot, 'extractedText'>>;
  };
  workUnits?: ExecutionWorkUnitInput[];
  coordinationMode?: import('@zana-ai/zcc-domain/product').TeamCoordinationMode;
}

/** @deprecated Use ExecutionRequestV1. Retained for Team backend callers. */
export type SquadExecutionRequestV1 = ExecutionRequestV1;

export interface ExecutionServiceDeps {
  store: ReturnType<typeof createExecutionStore>;
  artifacts: ReturnType<typeof createExecutionArtifactStore>;
  sources?: Pick<ReturnType<typeof createExecutionSourceRegistry>, 'list' | 'read'> & Partial<Pick<ReturnType<typeof createExecutionSourceRegistry>, 'pruneSnapshots'>>;
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
  triggerDeliveryDrain?: (sessionId: string) => void;
  inbox?: { append: (input: any) => Promise<any> };
  preflightWorkflow?: (teamId: string, workflow: SquadBundleWorkflowMetadataV1) => { ok: boolean; code?: string; message?: string };
  resumeGrants?: ReturnType<typeof createResumeGrantStore>;
  hasLivePredecessor?: (projectId: string, ownerPrincipalIds: readonly string[]) => boolean;
  clearResumeToken?: (projectId: string, executionId: string) => void | Promise<void>;
  cacheResumeToken?: (projectId: string, executionId: string, token: string, expiresAt: number) => void | Promise<void>;
  monotonicNow?: () => number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
}

function withoutDefaultLaunchKind(request: ExecutionRequestV1): ExecutionRequestV1 {
  if (request.launchKind !== 'team') return request;
  const { launchKind: _launchKind, launchDisplay: _launchDisplay, ...legacyShape } = request;
  return legacyShape;
}

export class ExecutionSnapshotTimeoutError extends Error {
  constructor() {
    super('Snapshot exceeded 15-second budget');
  }
}

interface ExtractedLifecycle {
  orchestratorSessionId?: string;
  orchestratorAuthorizationId?: string;
  workers?: Array<{
    slotId?: string;
    sessionId?: string;
    authorizationId?: string;
    projectId?: string;
    process?: string;
    task?: string;
  }>;
  launchResult?: {
    failedSlots?: unknown[];
    orchestratorSessionId?: string;
  };
  outcome?: {
    status?: string;
    result?: { ok?: boolean; message?: string };
  };
}

function extractLifecycleInfo(lifecycle: any): ExtractedLifecycle | undefined {
  if (!lifecycle) return undefined;
  const launchResult = lifecycle.launchResult;
  const orchestratorSessionId = launchResult?.orchestratorSessionId || lifecycle.orchestratorSessionId;

  const workers = lifecycle.workers || launchResult?.workers;
  const orchestratorWorker = workers?.find((w: any) => w.slotId === 'orchestrator' || w.slotId?.startsWith('orchestrator:'));
  const orchestratorAuthorizationId = orchestratorWorker?.authorizationId || lifecycle.orchestratorAuthorizationId;

  return {
    orchestratorSessionId,
    orchestratorAuthorizationId,
    workers: lifecycle.workers,
    launchResult: lifecycle.launchResult,
    outcome: lifecycle.outcome
  };
}

export class ExecutionService {
  private readonly starting = new Map<string, number>();
  private readonly bindingTails = new Map<string, Promise<void>>();
  private readonly pendingBindingOwners = new Map<string, string>();
  private readonly mintFlights = new Map<string, Promise<ReturnType<ExecutionService['mintResumeGrantOnce']> extends Promise<infer T> ? T : never>>();
  private readonly deadlineWatchdog: ExecutionDeadlineWatchdog;

  constructor(private readonly deps: ExecutionServiceDeps) {
    this.deadlineWatchdog = new ExecutionDeadlineWatchdog({
      now: deps.now ?? Date.now,
      setTimer: deps.setTimer ?? setTimeout,
      clearTimer: deps.clearTimer ?? clearTimeout,
      onDeadline: async (executionId) => { await this.timeoutExecution(executionId); }
    });
  }

  async start(callerPrincipalId: string, projectId: string, request: ExecutionRequestV1): Promise<
    { ok: true; value: ExecutionRecord & { resumeToken?: string; resumeTokenExpiresAt?: number } } | { ok: false; code: string; message: string }
  > {
    if (request.version !== 1 || (request.launchKind !== undefined && request.launchKind !== 'team')
      || !request.teamId?.trim() || !request.launchRequestId?.trim() || !request.slots?.length) {
      return { ok: false, code: 'INVALID', message: 'invalid execution request' };
    }
    const jobTitle = deriveJobTitle(request);
    const summary = request.summary?.trim() || undefined;
    const resolvedModels = request.resolvedModels ?? [];
    if (!hasUniqueModelSlots(resolvedModels)) return { ok: false, code: 'INVALID', message: 'duplicate resolved model slot' };
    const startingKey = `${callerPrincipalId}:${request.launchRequestId}`;
    this.beginStarting(startingKey);
    let claim;
    try {
      claim = await this.deps.store.claim({
        callerPrincipalId, projectId, teamId: request.teamId, launchKind: request.launchKind ?? 'team',
        ...(request.launchDisplay ? { launchDisplay: request.launchDisplay } : {}), jobTitle, summary,
        ...(request.coordinationMode ? { coordinationMode: request.coordinationMode } : {}),
        launchRequestId: request.launchRequestId,
        request: { version: 1, launchKind: request.launchKind ?? 'team', ...(request.launchDisplay ? { launchDisplay: request.launchDisplay } : {}), slots: request.slots, policy: request.policy, workflow: request.workflow, resolvedModels, sourceBundle: request.sourceBundle, goal: request.goal },
        ...(request.workUnits ? { workUnits: request.workUnits } : {}),
        resolvedModels,
        requestDigest: launchDigest({ callerPrincipalId, projectId, request: { ...withoutDefaultLaunchKind(request), jobTitle, summary } })
      });
    } catch (error) {
      this.endStarting(startingKey);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
    this.endStarting(startingKey);
    if (claim.outcome === 'conflict') return { ok: false, code: 'CONFLICT', message: 'execution request id reused with changed input' };
    if (claim.outcome === 'replay') {
      const reconciled = await this.reconcile(callerPrincipalId, projectId, claim.record);
      this.deadlineWatchdog.schedule(reconciled);
      if (reconciled.state === 'BLOCKED' || reconciled.state === 'FAILED') {
        return { ok: false, code: reconciled.state, message: `execution is ${reconciled.state.toLowerCase()}` };
      }
      return { ok: true, value: reconciled };
    }
    this.deadlineWatchdog.schedule(claim.record);

    let record: ExecutionRecord;
    let resumeGrant: { token: string; expiresAt: number } | undefined;
    this.beginStarting(claim.record.id);
    try {
      if (request.workflow) {
        const preflight = this.deps.preflightWorkflow?.(request.teamId, request.workflow);
        if (!preflight?.ok || !request.workflow.supportedRequestVersions.includes(request.version)) {
          const message = !preflight?.ok
            ? preflight?.message ?? 'workflow profiles are unavailable'
            : 'workflow profile does not support this execution request version';
          const blocked = await this.deps.store.transition(claim.record.id, claim.record.stateVersion, 'BLOCKED', 'warning', message);
          this.endStarting(claim.record.id);
          return { ok: false, code: preflight?.code ?? 'INVALID_WORKFLOW_PROFILE', message: blocked ? message : 'workflow profile is unavailable' };
        }
      }
      record = await this.deps.store.transition(claim.record.id, claim.record.stateVersion, 'STARTING', 'info', 'Team launch authorized');
    } catch (error) {
      this.endStarting(claim.record.id);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
    try {
      if (this.deps.resumeGrants) {
        resumeGrant = await this.deps.resumeGrants.mint({ executionId: claim.record.id, projectId, callerPrincipalId, expiresAt: claim.record.recoveryDeadlineAt });
        await this.deps.cacheResumeToken?.(projectId, claim.record.id, resumeGrant.token, resumeGrant.expiresAt);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.failLaunch(record, `Resume grant setup failed: ${message}`);
      this.endStarting(claim.record.id);
      return { ok: false, code: 'EXECUTION_STORE_ERROR', message };
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
      if (!await this.launchMayProceed(record)) {
        return { ok: false, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed before Team launch' };
      }
      const launched = await this.deps.launchTeam(request.teamId, projectId, {
        callerPrincipalId, launchRequestId: record.teamLaunchRequestId, slots: authorization.value.slots,
        policy: request.policy, requirePreauthorization: true, executionId: record.id, executionJobTitle: record.jobTitle,
        ...(request.coordinationMode ? { coordinationMode: request.coordinationMode } : {}),
        ...(request.coordinationMode === 'job-team' ? { jobContext: {
          goal: request.goal?.trim() || record.jobTitle,
          title: record.jobTitle,
          ...(record.summary ? { summary: record.summary } : {}),
          ...(request.sourceBundle ? { sourceBundle: request.sourceBundle } : {})
        } } : {})
      });
      if (!launched.ok) {
        await this.transitionOrCurrent(record, 'FAILED', 'error', launched.message ?? 'Team launch failed');
        return { ok: false, code: launched.code ?? 'TEAM_LAUNCH_FAILED', message: launched.message ?? 'Team launch failed' };
      }
      if (!await this.launchMayProceed(record)) {
        return { ok: false, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed during Team launch' };
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

  async pruneRetainedSources(): Promise<void> {
    try {
      if (!this.deps.sources?.pruneSnapshots) return;
      await this.deps.sources.pruneSnapshots(await this.deps.store.retainedSourceContentRefs(), EXECUTION_RETENTION_MS);
    } catch {
      // Retention cleanup must not block boot or execution control.
    }
  }

  async restoreDeadlines(): Promise<void> {
    this.deadlineWatchdog.restore(await this.deps.store.listActive());
  }

  dispose(): void {
    this.deadlineWatchdog.dispose();
  }

  /** Main-only project projection. Never expose through owner-scoped MCP routes. */
  async listProject(projectId: string, before?: number, limit = 50) {
    const page = await this.deps.store.listInProject(projectId, before, limit);
    return {
      records: await Promise.all(page.records.map((record) => this.reconcile(record.callerPrincipalId, projectId, record))),
      hasMore: page.hasMore
    };
  }

  async events(callerPrincipalId: string, projectId: string, executionId: string, after = 0, limit = 100) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    return record ? this.deps.store.eventsInProject(projectId, executionId, after, limit) : { events: [] };
  }

  /**
   * Read a bounded durable snapshot without reconciling Team lifecycle state.
   * Reconciliation may mutate state after a caller deadline, so it remains an
   * explicit operation rather than part of an observer snapshot.
   */
  async snapshot(callerPrincipalId: string, projectId: string, executionId: string, after = 0) {
    const now = this.deps.monotonicNow ?? (() => performance.now());
    const deadline = now() + 15_000;
    const checkDeadline = () => {
      if (now() >= deadline) throw new ExecutionSnapshotTimeoutError();
    };
    checkDeadline();
    const execution = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!execution) return undefined;
    checkDeadline();
    const executions = await this.deps.store.list(callerPrincipalId, projectId);
    checkDeadline();
    return this.readSnapshot(execution, executions, projectId, after, checkDeadline);
  }

  async snapshotBound(binding: ExecutionCohortBinding, after = 0) {
    const now = this.deps.monotonicNow ?? (() => performance.now());
    const deadline = now() + 15_000;
    const checkDeadline = () => {
      if (now() >= deadline) throw new ExecutionSnapshotTimeoutError();
    };
    checkDeadline();
    const execution = await this.getBound(binding);
    if (!execution) return undefined;
    checkDeadline();
    return this.readSnapshot(execution, [execution], binding.projectId, after, checkDeadline);
  }

  private async readSnapshot(execution: ExecutionRecord, executions: ExecutionRecord[], projectId: string, after: number, checkDeadline: () => void) {
    const events = [];
    let cursor = after;
    for (;;) {
      const page = await this.deps.store.eventsInProject(projectId, execution.id, cursor, 100);
      checkDeadline();
      events.push(...page.events);
      if (page.nextSequence === undefined) break;
      cursor = page.nextSequence;
    }
    const artifacts = await this.deps.artifacts.list(execution.id, projectId);
    checkDeadline();
    return {
      execution,
      executions,
      events,
      nextAfter: events.at(-1)?.sequence ?? after,
      truncated: false,
      artifacts: artifacts.slice(0, 100),
      artifactsTruncated: artifacts.length > 100
    };
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

  async registerPlan(binding: ExecutionCohortBinding, workUnits: ExecutionWorkUnitInput[]) {
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can register execution plan');
    return this.mutateBound(binding, (record) => this.deps.store.registerPlan(record.id, record.stateVersion, workUnits));
  }

  async claimWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId?: string) {
    if (binding.role !== 'worker') return deniedBound('coordinator must use execution.work.assign');
    return this.mutateBound(binding, (record) => this.deps.store.claimWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId));
  }

  async assignWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId: string) {
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can assign work');
    return this.mutateBound(binding, (record) => this.deps.store.claimWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId));
  }

  async completeWork(binding: ExecutionCohortBinding, workUnitId: string, result: string) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can complete work');
    return this.mutateBound(binding, (record) => this.deps.store.completeWork(record.id, record.stateVersion, binding, workUnitId, result));
  }

  async failWork(binding: ExecutionCohortBinding, workUnitId: string, failure: string) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can fail work');
    return this.mutateBound(binding, (record) => this.deps.store.failWork(record.id, record.stateVersion, binding, workUnitId, failure));
  }

  async blockWork(binding: ExecutionCohortBinding, workUnitId: string, blocker: { id: string; question: string; options?: string[] }) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can block work');
    const result = await this.mutateBound(binding, (record) => this.deps.store.blockWork(record.id, record.stateVersion, binding, workUnitId, blocker));
    if (result.ok) {
      const record = result.value;
      const questionData = blocker.options ? buildInboxQuestion({ options: blocker.options }, true) : {};
      void this.deps.inbox?.append({
        projectId: binding.projectId,
        subject: record.jobTitle || 'Job Execution Blocked',
        comments: blocker.question,
        executionId: record.id,
        blockerId: blocker.id,
        ...questionData
      }).catch((err) => {
        console.error('Failed to append linked inbox entry for execution blocker', err);
      });
    }
    return result;
  }

  async releaseWork(binding: ExecutionCohortBinding, workUnitId: string) {
    if (binding.role !== 'worker') return deniedBound('only assigned worker can release work');
    return this.mutateBound(binding, (record) => this.deps.store.releaseWork(record.id, record.stateVersion, binding, workUnitId));
  }

  async retryWork(binding: ExecutionCohortBinding, workUnitId: string, assignedSlotId?: string) {
    return this.mutateBound(binding, (record) => this.deps.store.retryWork(record.id, record.stateVersion, binding, workUnitId, assignedSlotId));
  }

  async retryWorkFromBoard(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, workUnitId: string, assignedSlotId?: string) {
    return this.mutateOwnedWork(callerPrincipalId, projectId, executionId, expectedStateVersion,
      (record, authority) => this.deps.store.retryWork(record.id, expectedStateVersion, authority, workUnitId, assignedSlotId));
  }

  async releaseWorkFromBoard(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, workUnitId: string) {
    return this.mutateOwnedWork(callerPrincipalId, projectId, executionId, expectedStateVersion,
      (record, authority) => this.deps.store.releaseWork(record.id, expectedStateVersion, authority, workUnitId));
  }

  async reassignWorkFromBoard(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, workUnitId: string, assignedSlotId: string) {
    return this.mutateOwnedWork(callerPrincipalId, projectId, executionId, expectedStateVersion,
      (record, authority) => this.deps.store.reassignWork(record.id, expectedStateVersion, authority, workUnitId, assignedSlotId));
  }

  async reportBoundEvent(binding: ExecutionCohortBinding, input: Omit<Parameters<ExecutionServiceDeps['store']['producerEvent']>[1], 'slotId' | 'producerRole'>) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    try { return { ok: true as const, value: await this.deps.store.producerEvent(record.id, { ...input, slotId: binding.slotId, producerRole: binding.role }) }; }
    catch (error) { return invalidBound(error); }
  }

  async putBoundArtifact(binding: ExecutionCohortBinding, name: string, mediaType: string, content: string) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    try {
      const artifact = await this.deps.artifacts.put({ executionId: record.id, attempt: record.attempt, projectId: record.projectId, name, mediaType, content, producerRole: binding.role, producerSlotId: binding.slotId });
      return artifact.outcome === 'conflict' ? { ok: false as const, code: 'CONFLICT', message: 'artifact name already has different content' } : { ok: true as const, value: artifact.record };
    } catch (error) { return invalidBound(error); }
  }

  async listBoundArtifacts(binding: ExecutionCohortBinding) {
    const record = await this.getBound(binding);
    return record ? { ok: true as const, value: await this.deps.artifacts.list(record.id, record.projectId) } : deniedBound('execution not found for bound cohort');
  }

  async listSources(binding: ExecutionCohortBinding, page: { offset?: number; limit?: number }) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can read execution sources');
    if (!record.request.sourceBundle || !this.deps.sources) return { ok: false as const, code: 'NOT_FOUND', message: 'execution has no sources' };
    try { return { ok: true as const, value: await this.deps.sources.list(record.request.sourceBundle.contentRef, page, record.request.sourceBundle.sources, async (sources) => {
      await this.deps.store.upgradeSourceBundle(record.id, record.request.sourceBundle!.sources, sources);
    }) }; } catch (error) { return invalidBound(error); }
  }

  async readSource(binding: ExecutionCohortBinding, sourceId: string, page: { offset?: number; maxBytes?: number }) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (binding.role !== 'orchestrator') return deniedBound('only coordinator can read execution sources');
    if (!record.request.sourceBundle?.sources.some((source) => source.id === sourceId) || !this.deps.sources) return { ok: false as const, code: 'NOT_FOUND', message: 'execution source not found' };
    try { return { ok: true as const, value: await this.deps.sources.read(record.request.sourceBundle.contentRef, sourceId, page, record.request.sourceBundle.sources, async (sources) => {
      await this.deps.store.upgradeSourceBundle(record.id, record.request.sourceBundle!.sources, sources);
    }) }; } catch (error) { return invalidBound(error); }
  }

  async completeByCoordinatorBinding(binding: ExecutionCohortBinding, correlationExecutionId: string | undefined, summary: string) {
    if (binding.role !== 'orchestrator' || correlationExecutionId && correlationExecutionId !== binding.executionId) return deniedBound('execution not found for bound coordinator');
    const result = await this.mutateBound(binding, (record) => this.deps.store.completeExecution(record.id, record.stateVersion, summary));
    if (result.ok) {
      await this.cleanupTerminal(result.value);
      await this.deps.cancelTeamLaunch(result.value.callerPrincipalId, result.value.teamLaunchRequestId);
    }
    return result;
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
      if (!await this.launchMayProceed(current)) {
        return { ok: false as const, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed before Team retry launch', value: await this.deps.store.get(current.id) };
      }
      const launched = await this.deps.launchTeam(retry.teamId, projectId, {
        callerPrincipalId: retry.callerPrincipalId, launchRequestId: retry.teamLaunchRequestId,
        slots: authorization.value.slots, policy: request.policy, requirePreauthorization: true,
        executionId: retry.id, executionJobTitle: retry.jobTitle,
        ...(retry.coordinationMode ? { coordinationMode: retry.coordinationMode } : {}),
        ...(retry.coordinationMode === 'job-team' ? { jobContext: {
          goal: request.goal?.trim() || retry.jobTitle,
          title: retry.jobTitle,
          ...(retry.summary ? { summary: retry.summary } : {}),
          ...(request.sourceBundle ? { sourceBundle: request.sourceBundle } : {})
        } } : {})
      });
      if (!launched.ok) {
        const failed = await this.failLaunch(current, launched.message ?? 'Team launch failed');
        return { ok: false as const, code: launched.code ?? 'TEAM_LAUNCH_FAILED', message: launched.message ?? 'Team launch failed', value: failed };
      }
      if (!await this.launchMayProceed(current)) {
        return { ok: false as const, code: 'DEADLINE_EXCEEDED', message: 'execution deadline elapsed during Team retry launch', value: await this.deps.store.get(current.id) };
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

  async readArtifact(callerPrincipalId: string, projectId: string, executionId: string, artifactId: string) {
    const artifacts = await this.listArtifacts(callerPrincipalId, projectId, executionId);
    return artifacts?.find((artifact) => artifact.id === artifactId);
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

  async dismiss(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    try {
      // Terminal execution history can hide only after its Team teardown has
      // started. Otherwise a failed job card disappears while live workers keep
      // running as orphaned terminal cards.
      const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      const lifecycle = extractLifecycleInfo(rawLifecycle);
      const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      if (!canceled.ok && canceled.code !== 'NOT_FOUND') {
        return {
          ok: false as const,
          code: canceled.code ?? 'CANCEL_FAILED',
          message: canceled.message ?? 'Team cancellation failed'
        };
      }
      await this.deps.store.dismiss(record.id);
      return {
        ok: true as const,
        value: { dismissedSessionIds: lifecycle?.workers?.flatMap((worker) => worker.sessionId ? [worker.sessionId] : []) ?? [] }
      };
    } catch (error) {
      return { ok: false as const, code: 'DISMISS_NOT_ALLOWED', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async respond(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, slotId: string, response: string) {
    return this.deliver(callerPrincipalId, projectId, executionId, expectedStateVersion, slotId, response, false);
  }

  async resume(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, slotId: string, message: string) {
    return this.deliver(callerPrincipalId, projectId, executionId, expectedStateVersion, slotId, message, true);
  }

  async respondToBlocker(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, clientRequestId: string, message: string) {
    return this.deliverToBlocker(callerPrincipalId, projectId, executionId, expectedStateVersion, blockerId, clientRequestId, message, false);
  }

  async resumeBlocker(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, clientRequestId: string, message: string) {
    return this.deliverToBlocker(callerPrincipalId, projectId, executionId, expectedStateVersion, blockerId, clientRequestId, message, true);
  }

  async retryBlockerDelivery(callerPrincipalId: string, projectId: string, executionId: string, expectedStateVersion: number, blockerId: string, deliveryId: string) {
    if (!blockerId.trim() || !deliveryId.trim()) return { ok: false as const, code: 'INVALID', message: 'invalid execution delivery retry request' };
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    try {
      return { ok: true as const, value: await this.deps.store.retryBlockerDelivery(record.id, expectedStateVersion, blockerId, deliveryId) };
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') {
        return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
      }
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  async pullDelivery(binding: ExecutionCohortBinding) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    const current = await this.currentCohortIdentity(record, binding);
    if (!current) return deniedBound('execution delivery route is not current');
    try { return { ok: true as const, value: await this.deps.store.pullBlockerDelivery({ ...binding, ...current }) ?? null }; }
    catch (error) { return invalidBound(error); }
  }

  async ackDelivery(binding: ExecutionCohortBinding, deliveryId: string, leaseId: string, result: { delivered: boolean; error?: string }) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    const current = await this.currentCohortIdentity(record, binding);
    if (!current) return deniedBound('execution delivery route is not current');
    try {
      const ack = await this.deps.store.ackBlockerDelivery({ ...binding, ...current }, deliveryId, leaseId, result);
      return { ok: true as const, value: {
        deliveryId: ack.delivery.id, blockerId: ack.delivery.blockerId, state: ack.delivery.state,
        resolved: ack.delivery.state === 'DELIVERED', outcome: ack.outcome
      } };
    } catch (error) { return invalidBound(error); }
  }

  /** Only the live Team coordinator can declare a durable job complete. */
  async completeByCoordinator(callerPrincipalId: string, projectId: string, executionId: string, summary: string) {
    if (!summary.trim() || summary.length > 64 * 1024) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution completion summary' };
    }
    const record = await this.deps.store.getInProject(projectId, executionId);
    if (!record || record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'NOT_FOUND', message: 'execution is not active' };
    }
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    const isOriginalCoordinator = lifecycle?.orchestratorSessionId === callerPrincipalId;
    const isBoundMonitor = record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId) ?? false;
    if (!isOriginalCoordinator && !isBoundMonitor) {
      return { ok: false as const, code: 'DENIED', message: 'only the Team coordinator can complete this execution' };
    }
    try {
      const completed = await this.deps.store.completeExecution(record.id, record.stateVersion, summary.trim());
      await this.cleanupTerminal(completed);
      await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      return { ok: true as const, value: completed };
    } catch (error) {
      return { ok: false as const, code: 'CONFLICT', message: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Main-only PTY-exit hook. Jobs survive a lost coordinator for monitor recovery. */
  async handleCoordinatorExit(projectId: string, executionId: string, sessionId: string) {
    const record = await this.deps.store.getInProject(projectId, executionId);
    if (!record || record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') return;
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    if (lifecycle?.orchestratorSessionId !== sessionId) return;
    await this.emitOrCurrent(record, 'warning', 'Coordinator exited; execution remains available for monitor recovery');
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

  private async getBound(binding: ExecutionCohortBinding) {
    return this.deps.store.getInProject(binding.projectId, binding.executionId);
  }

  private async currentCohortIdentity(record: ExecutionRecord, binding: ExecutionCohortBinding): Promise<{ principalId: string; authorizationId?: string } | undefined> {
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    if (binding.role === 'orchestrator') {
      return lifecycle?.orchestratorSessionId && lifecycle.orchestratorSessionId === binding.principalId
        ? { principalId: lifecycle.orchestratorSessionId, ...(lifecycle.orchestratorAuthorizationId ? { authorizationId: lifecycle.orchestratorAuthorizationId } : {}) }
        : undefined;
    }
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === binding.slotId
      && candidate.projectId === record.projectId);
    return worker?.sessionId && worker.sessionId === binding.principalId
      ? { principalId: worker.sessionId, ...(worker.authorizationId ? { authorizationId: worker.authorizationId } : {}) }
      : undefined;
  }

  private async mutateBound(binding: ExecutionCohortBinding, operation: (record: ExecutionRecord) => Promise<ExecutionRecord>) {
    const record = await this.getBound(binding);
    if (!record) return deniedBound('execution not found for bound cohort');
    if (isResumeGrantTerminal(record.state)) return terminalBound(record);
    try { return { ok: true as const, value: await operation(record) }; }
    catch (error) { return error instanceof Error && /another slot|only coordinator/.test(error.message) ? deniedBound(error.message) : invalidBound(error); }
  }

  private async mutateOwnedWork(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    expectedStateVersion: number,
    operation: (record: ExecutionRecord, authority: ExecutionCohortAuthority) => Promise<ExecutionRecord>
  ) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    if (!Number.isInteger(expectedStateVersion)) return { ok: false as const, code: 'INVALID', message: 'invalid execution work control request' };
    try {
      return { ok: true as const, value: await operation(record, { role: 'orchestrator', slotId: 'board:owner' }) };
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') {
        return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
      }
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
  }

  private async getAuthorizedForControl(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.deps.store.get(executionId);
    return record && record.projectId === projectId
      && (record.callerPrincipalId === callerPrincipalId || record.effectiveOwnerPrincipalIds?.includes(callerPrincipalId)) ? record : undefined;
  }

  async resumeBinding(callerPrincipalId: string, projectId: string, executionId: string, token: string) {
    return this.serializeBinding(executionId, async () => {
      const record = await this.deps.store.getInProject(projectId, executionId);
      if (!record || isResumeGrantTerminal(record.state) || !this.deps.resumeGrants) {
        return { ok: false as const, code: 'NOT_FOUND', message: 'execution resume grant is not current' };
      }
      const pendingOwner = this.pendingBindingOwners.get(executionId);
      const ownerIds = [record.callerPrincipalId, ...(record.effectiveOwnerPrincipalIds ?? []), ...(pendingOwner ? [pendingOwner] : [])];
      if (pendingOwner && pendingOwner !== callerPrincipalId) {
        return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' };
      }
      if (this.deps.hasLivePredecessor?.(projectId, ownerIds)) {
        return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' };
      }
      try {
        await this.deps.resumeGrants.consume({ token, executionId, projectId, effectiveOwnerPrincipalId: callerPrincipalId, generation: record.recoveryGeneration });
        this.pendingBindingOwners.set(executionId, callerPrincipalId);
        const value = await this.deps.store.addEffectiveOwner(executionId, callerPrincipalId);
        this.pendingBindingOwners.delete(executionId);
        return { ok: true as const, value };
      } catch (error) {
        if (this.pendingBindingOwners.get(executionId) === callerPrincipalId) {
          this.pendingBindingOwners.delete(executionId);
        }
        if (error instanceof Error && error.message === 'execution resume grant is not current') {
          return { ok: false as const, code: 'NOT_FOUND', message: error.message };
        }
        return { ok: false as const, code: 'BINDING_TRANSIENT', message: 'execution resume binding could not be persisted; retry with the same token' };
      }
    });
  }

  async rotateRecoveryGrant(projectId: string, executionId: string, expectedStateVersion: number, expectedGeneration: number) {
    return this.serializeBinding(executionId, async () => {
      const record = await this.deps.store.getInProject(projectId, executionId);
      if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for project' };
      if (isResumeGrantTerminal(record.state)) return { ok: false as const, code: 'TERMINAL', message: 'execution is terminal' };
      if (record.stateVersion !== expectedStateVersion || (record.recoveryGeneration ?? 0) !== expectedGeneration) {
        return { ok: false as const, code: 'CONFLICT', message: 'stale execution state or recovery generation' };
      }
      const owners = [record.callerPrincipalId, ...(record.effectiveOwnerPrincipalIds ?? [])];
      if (this.deps.hasLivePredecessor?.(projectId, owners)) {
        return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live coordinator' };
      }
      if (!this.deps.resumeGrants) return { ok: false as const, code: 'NOT_FOUND', message: 'execution recovery is unavailable' };
      try {
        const rotated = await this.deps.resumeGrants.rotate({ executionId, projectId, callerPrincipalId: record.callerPrincipalId, expectedGeneration, expiresAt: record.recoveryDeadlineAt });
        try {
          const value = await this.deps.store.rotateRecoveryGeneration(executionId, expectedStateVersion, expectedGeneration, rotated.generation);
          await this.deps.cacheResumeToken?.(projectId, executionId, rotated.token, rotated.expiresAt);
          return { ok: true as const, value: { ...value, token: rotated.token, expiresAt: rotated.expiresAt, generation: rotated.generation } };
        } catch (error) {
          return { ok: false as const, code: 'CONFLICT', message: error instanceof Error ? error.message : String(error) };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false as const, code: message.includes('stale') ? 'CONFLICT' : 'ROTATE_TRANSIENT', message };
      }
    });
  }

  async mintResumeGrant(callerPrincipalId: string, projectId: string, executionId: string) {
    const record = await this.getAuthorized(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'DENIED', message: 'caller is not authorized to mint this execution resume grant' };
    const key = `${callerPrincipalId}\u0000${projectId}\u0000${executionId}`;
    const existing = this.mintFlights.get(key);
    if (existing) return existing;
    const flight = this.mintResumeGrantOnce(callerPrincipalId, projectId, executionId);
    this.mintFlights.set(key, flight);
    try { return await flight; } finally { if (this.mintFlights.get(key) === flight) this.mintFlights.delete(key); }
  }

  private async mintResumeGrantOnce(callerPrincipalId: string, projectId: string, executionId: string) {
    return this.serializeBinding(executionId, async () => {
    const record = await this.getAuthorized(callerPrincipalId, projectId, executionId);
    if (!record || !this.deps.resumeGrants || isResumeGrantTerminal(record.state)) {
      return { ok: false as const, code: 'NOT_FOUND', message: 'execution resume grant is not current' };
    }
    const owners = [record.callerPrincipalId, ...(record.effectiveOwnerPrincipalIds ?? [])];
    if (this.deps.hasLivePredecessor?.(projectId, owners)) {
      return { ok: false as const, code: 'LIVE_PREDECESSOR', message: 'execution still has a live predecessor' };
    }
    try {
      const grant = await this.deps.resumeGrants.rotate({ executionId, projectId, callerPrincipalId, expectedGeneration: record.recoveryGeneration ?? 0, expiresAt: record.recoveryDeadlineAt });
      const value = await this.deps.store.rotateRecoveryGeneration(executionId, record.stateVersion, record.recoveryGeneration ?? 0, grant.generation);
      await this.deps.cacheResumeToken?.(projectId, executionId, grant.token, grant.expiresAt);
      return { ok: true as const, value: { ...grant, recoveryGeneration: value.recoveryGeneration } };
    } catch (error) {
      return { ok: false as const, code: 'MINT_TRANSIENT', message: error instanceof Error ? error.message : String(error) };
    }
    });
  }

  async revokeResumeGrant(callerPrincipalId: string, projectId: string, executionId: string, effectiveOwnerPrincipalId?: string) {
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record || !this.deps.resumeGrants) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    await this.deps.resumeGrants.revoke(executionId, projectId);
    const value = effectiveOwnerPrincipalId ? await this.deps.store.removeEffectiveOwner(executionId, effectiveOwnerPrincipalId) : record;
    return { ok: true as const, value };
  }

  async abandonResumeBinding(projectId: string, executionId: string, effectiveOwnerPrincipalId: string): Promise<void> {
    await this.serializeBinding(executionId, async () => {
      await this.deps.resumeGrants?.revokeBound(executionId, projectId, effectiveOwnerPrincipalId);
      const record = await this.deps.store.getInProject(projectId, executionId);
      if (record?.effectiveOwnerPrincipalIds?.includes(effectiveOwnerPrincipalId)) {
        await this.deps.store.removeEffectiveOwner(executionId, effectiveOwnerPrincipalId);
      }
    });
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

  private async deliverToBlocker(
    callerPrincipalId: string,
    projectId: string,
    executionId: string,
    expectedStateVersion: number,
    blockerId: string,
    clientRequestId: string,
    text: string,
    resume: boolean
  ) {
    if (!blockerId.trim() || !clientRequestId.trim() || !text.trim() || Buffer.byteLength(text, 'utf8') > 16 * 1024) {
      return { ok: false as const, code: 'INVALID', message: 'invalid execution blocker delivery request' };
    }
    const record = await this.getAuthorizedForControl(callerPrincipalId, projectId, executionId);
    if (!record) return { ok: false as const, code: 'NOT_FOUND', message: 'execution not found for caller' };
    const blocker = record.blockers?.find((candidate) => candidate.id === blockerId && !candidate.resolved);
    if (!blocker) return { ok: false as const, code: 'NOT_FOUND', message: 'execution blocker not found' };
    return this.enqueueOwnedBlocker(record, expectedStateVersion, blocker, clientRequestId, text, resume);
  }

  private async deliverOwned(record: ExecutionRecord, expectedStateVersion: number, slotId: string, text: string, resume: boolean) {
    if (record.state === 'COMPLETED' || record.state === 'FAILED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
    }
    const blockers = record.blockers?.filter((candidate) => !candidate.resolved && candidate.slotId === slotId) ?? [];
    if (blockers.length === 0) {
      if (record.stateVersion !== expectedStateVersion) return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: record };
      return this.deliverLegacyMessage(record, expectedStateVersion, slotId, text, resume);
    }
    if (blockers.length > 1) return { ok: false as const, code: 'CONFLICT', message: 'execution slot has multiple unresolved blockers; select exact blocker' };
    const blocker = blockers[0];
    return this.enqueueOwnedBlocker(record, expectedStateVersion, blocker, `${record.id}:${expectedStateVersion}:${blocker.id}`, text, resume);
  }

  private async enqueueOwnedBlocker(record: ExecutionRecord, expectedStateVersion: number, blocker: NonNullable<ExecutionRecord['blockers']>[number], clientRequestId: string, text: string, resume: boolean) {
    let enqueued: Awaited<ReturnType<ExecutionServiceDeps['store']['enqueueBlockerDelivery']>>;
    try {
      enqueued = await this.deps.store.enqueueBlockerDelivery(record.id, expectedStateVersion, {
        clientRequestId,
        blockerId: blocker.id,
        text
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'stale execution state') return { ok: false as const, code: 'CONFLICT', message: error.message, current: await this.deps.store.get(record.id) };
      return { ok: false as const, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
    }
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    let targetSessionId: string | undefined;
    if (blocker.slotId === 'orchestrator' || blocker.slotId.startsWith('orchestrator:')) {
      targetSessionId = lifecycle?.orchestratorSessionId;
    } else {
      const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === blocker.slotId && candidate.projectId === record.projectId);
      targetSessionId = worker?.sessionId;
    }
    let notified = false;
    try {
      notified = !!targetSessionId && this.deps.replyToSession(targetSessionId, `Execution response pending. Pull with execution.delivery.pull for execution ${record.id}.`);
    } catch {
      notified = false;
    }
    if (targetSessionId) {
      try { this.deps.triggerDeliveryDrain?.(targetSessionId); } catch {}
    }
    return { ok: true as const, pending: true as const, notified, delivery: enqueued.delivery, value: enqueued.record, resumeRequested: resume };
  }

  private async deliverLegacyMessage(record: ExecutionRecord, expectedStateVersion: number, slotId: string, text: string, resume: boolean) {
    const rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    const lifecycle = extractLifecycleInfo(rawLifecycle);
    const worker = lifecycle?.workers?.find((candidate) => candidate.slotId === slotId && candidate.projectId === record.projectId);
    if (!worker?.sessionId) return { ok: false as const, code: 'NOT_FOUND', message: 'execution slot not found for caller' };
    if (!this.deps.replyToSession(worker.sessionId, text)) return { ok: false as const, code: 'SESSION_GONE', message: 'execution slot is no longer live' };
    const fenced = await this.fenceCommand(record, expectedStateVersion, resume ? 'Execution resume requested' : 'Execution response requested', slotId);
    if (!fenced.ok) return fenced;
    const current = resume && fenced.value.state === 'BLOCKED'
      ? await this.transitionOrCurrent(fenced.value, 'RUNNING', 'info', `Execution resumed through slot ${slotId}`)
      : await this.emitOrCurrent(fenced.value, 'info', `Message delivered to slot ${slotId}`);
    return { ok: true as const, value: current };
  }

  private async stopOwned(record: ExecutionRecord, expectedStateVersion: number) {
    if (record.state === 'COMPLETED' || record.state === 'STOPPED') {
      return { ok: false as const, code: 'TERMINAL', message: `execution is already ${record.state.toLowerCase()}` };
    }
    if (record.state === 'FAILED') {
      if (record.stateVersion !== expectedStateVersion) return { ok: false as const, code: 'CONFLICT', message: 'stale execution state', current: record };
      const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
      return canceled.ok
        ? { ok: true as const, value: record, canceled: canceled.value }
        : { ok: false as const, code: canceled.code ?? 'CANCEL_FAILED', message: canceled.message ?? 'Team cancellation failed' };
    }
    const fenced = await this.fenceCommand(record, expectedStateVersion, 'Execution stop requested');
    if (!fenced.ok) return fenced;
    const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, fenced.value.teamLaunchRequestId);
    if (!canceled.ok && canceled.code !== 'NOT_FOUND') return { ok: false as const, code: canceled.code ?? 'CANCEL_FAILED', message: canceled.message ?? 'Team cancellation failed' };
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
    const deadlineMs = record.request.policy?.deadlineMs;
    if (deadlineMs && (this.deps.now ?? Date.now)() >= record.createdAt + deadlineMs
      && record.state !== 'COMPLETED' && record.state !== 'FAILED' && record.state !== 'STOPPED') {
      return this.timeoutExecution(record.id);
    }
    let rawLifecycle: any;
    try {
      rawLifecycle = await this.deps.getTeamLaunch(record.callerPrincipalId, record.launchRequestId);
    } catch {
      // A transient lifecycle read must not turn an active execution into a
      // durable blocker during status/list polling.
      return record;
    }
    const lifecycle = extractLifecycleInfo(rawLifecycle);
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
    // Worker-only Teams have no coordinator capable of explicit completion. Keep
    // their established all-worker completion contract; orchestrated jobs require
    // the coordinator's execution.complete call instead.
    if (!lifecycle.orchestratorSessionId && lifecycle.workers.length > 0
      && lifecycle.workers.every((worker) => worker.task === 'caller-reported-complete')) {
      return this.transitionOrCurrent(record, 'COMPLETED', 'info', 'All worker-only Team slots reported complete');
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

  private async serializeBinding<T>(executionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.bindingTails.get(executionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.bindingTails.set(executionId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.bindingTails.get(executionId) === tail) this.bindingTails.delete(executionId);
    }
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
    this.deadlineWatchdog.remove(record.id);
    try {
      await this.deps.resumeGrants?.revoke(record.id, record.projectId);
    } catch {
      // Grant and token cleanup are independent best-effort terminal work.
    }
    try {
      await this.deps.clearResumeToken?.(record.projectId, record.id);
    } catch {
      // Token cleanup is best effort; durable grant revocation already closes authority.
    }
  }

  private async timeoutExecution(executionId: string): Promise<ExecutionRecord> {
    const record = await this.deps.store.get(executionId);
    if (!record) throw new Error('execution not found');
    if (isResumeGrantTerminal(record.state)) {
      if (record.state === 'STOPPED') await this.cancelTimedOutLaunch(record);
      return record;
    }
    let stopped: ExecutionRecord;
    try {
      stopped = await this.deps.store.transition(record.id, record.stateVersion, 'STOPPED', 'warning', 'Execution timed out');
    } catch (error) {
      if (!(error instanceof Error) || error.message !== 'stale execution state') throw error;
      const current = await this.deps.store.get(executionId);
      if (!current) throw error;
      if (!isResumeGrantTerminal(current.state)) this.deadlineWatchdog.schedule(current);
      return current;
    }
    await this.cleanupTerminal(stopped);
    await this.cancelTimedOutLaunch(stopped);
    return stopped;
  }

  private async launchMayProceed(record: ExecutionRecord): Promise<boolean> {
    const current = await this.deps.store.get(record.id);
    if (!current) return false;
    const deadlineMs = current.request.policy?.deadlineMs;
    const expired = typeof deadlineMs === 'number'
      && Number.isFinite(deadlineMs)
      && deadlineMs > 0
      && (this.deps.now ?? Date.now)() >= current.createdAt + deadlineMs;
    if (!isResumeGrantTerminal(current.state) && !expired) return true;
    if (expired || current.state === 'STOPPED') {
      try {
        await this.timeoutExecution(current.id);
      } catch {
        // Watchdog owns bounded retry; post-launch fence still prevents RUNNING.
      }
    }
    return false;
  }

  private async cancelTimedOutLaunch(record: ExecutionRecord): Promise<void> {
    const canceled = await this.deps.cancelTeamLaunch(record.callerPrincipalId, record.teamLaunchRequestId);
    if (!canceled.ok) {
      throw new Error(`${canceled.code ?? 'CANCEL_FAILED'}: ${canceled.message ?? 'Team cancellation failed'}`);
    }
    this.deadlineWatchdog.remove(record.id);
  }
}

/** @deprecated Use ExecutionService. Retained for Team backend callers. */
export { ExecutionService as SquadExecutionService };

export function deriveJobTitle(request: Pick<ExecutionRequestV1, 'jobTitle' | 'summary' | 'teamId'>): string {
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

function deniedBound(message: string) {
  return { ok: false as const, code: 'DENIED', message };
}

function invalidBound(error: unknown) {
  return { ok: false as const, code: error instanceof Error && error.message === 'stale execution state' ? 'CONFLICT' : 'INVALID', message: error instanceof Error ? error.message : String(error) };
}

function terminalBound(record: ExecutionRecord) {
  return { ok: false as const, code: 'TERMINAL', message: `execution is ${record.state.toLowerCase()}` };
}
