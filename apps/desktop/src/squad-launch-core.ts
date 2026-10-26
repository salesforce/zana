import { basename } from 'node:path';
import { validateSquadExecutionTarget, type Project, type SquadExecutionTargetSelector, type TeamJobLaunchResponse } from '@zana-ai/zcc-domain/product';
import { AUTONOMOUS_DEFAULTS } from '@zana-ai/zcc-server/services/agents/autonomous-run-supervisor';
import type { ExpandedTeamSlot } from '@zana-ai/zcc-server/services/agents/team-slot-expansion';
import type { ExecutionRequestV1, SquadExecutionService } from '@zana-ai/zcc-server/services/execution/service';
import { ExecutionSourceError, type createExecutionSourceRegistry, type ExecutionSourcePathDescriptor } from '@zana-ai/zcc-server/services/execution/source-registry';
import { resolveSourcePolicy, type SourcePolicy } from '@zana-ai/zcc-server/services/execution/source-policy';
import type { ExecutionRecord, ExecutionReportTarget } from '@zana-ai/zcc-server/services/execution/store';
import { squadGoalTooLongMessage, squadLaunchTextProblem } from '@zana-ai/zcc-domain/squad-proposal';
import { PlanCorrectionService } from './plan-correction/service.js';
import { gateInvalidProvidedPlan, splitProposedGoalSources, teamJobFailureResponse, type ProvidedPlanGateDeps } from './team-launch-support.js';
import { planNormalizationNote, resolveSquadPlan } from './team-trigger-semantics.js';

type ExecutionSourceRegistry = ReturnType<typeof createExecutionSourceRegistry>;
export type SquadSourceBundle = Awaited<ReturnType<ExecutionSourceRegistry['resolve']>>;

/** Who vouches for the sources a launch snapshots: a trusted desktop window or an agent session. */
export type SquadSourceProvider =
  | { kind: 'window'; windowId: number }
  | { kind: 'session'; sessionId: string };

/** The principal a launch starts under, where its reports go, and the proposal it fulfils. */
export interface SquadLaunchOwner {
  principalId: string;
  reportTo?: ExecutionReportTarget;
  proposal?: NonNullable<ExecutionRecord['proposal']>;
}

export interface SquadSourceSnapshotArgs {
  projectId: string;
  launchRequestId: string;
  sourceCapabilityIds: string[];
  /** Confined realpaths to issue to a session provider; a window presents capability ids instead. */
  sourcePaths: readonly string[];
  goalSourceDescriptors: ExecutionSourcePathDescriptor[];
  policy: SourcePolicy;
}

export type SquadSourceSnapshotResult =
  | { ok: true; sourceBundle?: SquadSourceBundle }
  | { ok: false; code: string; message: string };

export type SnapshotSquadSources = (
  provider: SquadSourceProvider | undefined,
  args: SquadSourceSnapshotArgs
) => Promise<SquadSourceSnapshotResult>;

export interface SquadLaunchDeps {
  snapshotSources: SnapshotSquadSources;
  removeSnapshot(contentRef: string): Promise<void>;
  realpath(path: string): Promise<string>;
  sourceBases(): { home: string; cloneRoot?: string; dataDirs: string[]; protectedRoots: string[] };
  newLaunchRequestId(): string;
  inboxStore: ProvidedPlanGateDeps['inboxStore'];
  planCorrectionLaunchBinding: ProvidedPlanGateDeps['planCorrectionLaunchBinding'] & { forgetLaunch(launchRequestId: string): void };
  nameTeamExecution(launchId: string, objective: string, explicitTitle?: string, sourceTexts?: readonly (string | undefined)[]): Promise<string>;
  autonomousTimeoutMs(): number | undefined;
  squadExecutionService: Pick<SquadExecutionService, 'start'>;
  /** Reports a cleanup failure that was swallowed so the launch outcome stands. */
  log?(message: string, error: unknown): void;
}

/** A launch whose team, Project, and slots main has already looked up and authorized. */
export interface SquadLaunchInput {
  teamId: string;
  project: Pick<Project, 'id' | 'name' | 'path'>;
  slots: readonly Pick<ExpandedTeamSlot, 'role'>[];
  goal: string;
  coordinationMode: 'structured' | 'freeform';
  title?: string;
  summary?: string;
  completionInboxNotice: boolean;
  sourceCapabilityIds: string[];
  /** Realpaths main already confined, issued to a session provider (a window presents capability ids). */
  sourcePaths?: readonly string[];
  /** Files the goal names, as discovery found them under the shared source policy. */
  goalSources: ExecutionSourcePathDescriptor[];
  /** Realpaths of the sources a reviewed proposal card listed. */
  reviewedSourcePaths?: readonly string[];
  /** User-selected existing execution target; validated here, resolved and revalidated by main. */
  target?: SquadExecutionTargetSelector;
}

export interface SquadLaunchContext {
  sources?: SquadSourceProvider;
  owner: SquadLaunchOwner;
}

/**
 * Snapshot a launch's sources through the registry, bound to the provider that vouches for
 * them. Each provider kind resolves only capabilities issued to that same provider.
 */
export function createSquadSourceSnapshotter(
  registry: Pick<ExecutionSourceRegistry, 'issue' | 'resolve'>
): SnapshotSquadSources {
  return async (provider, args) => {
    if (!args.sourceCapabilityIds.length && !args.sourcePaths.length && !args.goalSourceDescriptors.length) return { ok: true };
    try {
      switch (provider?.kind) {
        case 'window':
          return { ok: true, sourceBundle: await snapshotWindowSources(registry, provider.windowId, args) };
        case 'session':
          return { ok: true, sourceBundle: await snapshotSessionSources(registry, provider.sessionId, args) };
        default:
          return { ok: false, code: 'INVALID_CAPABILITY', message: 'Execution sources require a trusted window' };
      }
    } catch (error) {
      return error instanceof ExecutionSourceError
        ? { ok: false, code: error.code, message: error.message }
        : { ok: false, code: 'SOURCE_SNAPSHOT_FAILED', message: error instanceof Error ? error.message : String(error) };
    }
  };
}

/** Issue capabilities for the goal-named paths, then snapshot every source of the launch. */
async function snapshotWindowSources(
  registry: Pick<ExecutionSourceRegistry, 'issue' | 'resolve'>,
  windowId: number,
  args: SquadSourceSnapshotArgs
): Promise<SquadSourceBundle | undefined> {
  const { projectId } = args;
  const goalSourceCapabilities = args.goalSourceDescriptors.length
    ? await registry.issue({ windowId, projectId, paths: args.goalSourceDescriptors.map(({ exactPath }) => exactPath), policy: args.policy })
    : [];
  const capabilityIds = [...new Set([...args.sourceCapabilityIds, ...goalSourceCapabilities.map(({ id }) => id)])];
  if (!capabilityIds.length) return undefined;
  return registry.resolve({
    windowId, projectId, capabilityIds, snapshotKey: args.launchRequestId.replace(/[^a-zA-Z0-9:_-]/g, '_')
  });
}

/**
 * Issue session-bound capabilities for the confined sources and the goal-named paths, then
 * snapshot them in the same launch. Each path is re-checked against the policy at issue, a
 * session never presents capability ids, and nothing is renewed: issue and resolve are one step.
 */
async function snapshotSessionSources(
  registry: Pick<ExecutionSourceRegistry, 'issue' | 'resolve'>,
  sessionId: string,
  args: SquadSourceSnapshotArgs
): Promise<SquadSourceBundle | undefined> {
  if (args.sourceCapabilityIds.length) {
    throw new ExecutionSourceError('INVALID_CAPABILITY', 'Agent sessions cannot present execution source capabilities');
  }
  const binding = { kind: 'session' as const, sessionId };
  const { projectId, policy } = args;
  const issue = async (paths: readonly string[]) => paths.length ? registry.issue({ binding, projectId, paths: [...paths], policy }) : [];
  // Two issues, as a goal may name a listed source: the registry hands back the same capability for it.
  const listed = await issue(args.sourcePaths);
  const named = await issue(args.goalSourceDescriptors.map(({ exactPath }) => exactPath));
  const capabilityIds = [...new Set([...listed, ...named].map(({ id }) => id))];
  if (!capabilityIds.length) return undefined;
  return registry.resolve({ binding, projectId, capabilityIds, snapshotKey: args.launchRequestId.replace(/[^a-zA-Z0-9:_-]/g, '_') });
}

/**
 * Start a Squad from authorized inputs: narrow goal sources to what a proposal showed,
 * snapshot sources through the provider, resolve the plan, and start the execution under
 * the owner. A window-launched run is attended, so an invalid provided plan parks for
 * correction; any other launch refuses it. Every failure after the snapshot discards it.
 */
export async function launchSquad(
  deps: SquadLaunchDeps,
  input: SquadLaunchInput,
  ctx: SquadLaunchContext
): Promise<TeamJobLaunchResponse> {
  const { project } = input;
  const { owner } = ctx;
  // Never fall back to a generated worktree when a selector is present but unusable.
  const targetCheck = validateSquadExecutionTarget({ target: input.target });
  if (!targetCheck.ok) return { ok: false, code: 'INVALID', message: targetCheck.message };
  // A proposed or agent-started launch attaches goal-named files outside the Project only when
  // they were listed: on the reviewed card, or in the agent's own sources.
  const sessionLaunch = ctx.sources?.kind === 'session';
  const sourcePaths = sessionLaunch ? input.sourcePaths ?? [] : [];
  let goalSourceDescriptors = input.goalSources;
  let redactedGoalSources = input.goalSources;
  if (owner.proposal || sessionLaunch) {
    const projectReal = await deps.realpath(project.path).catch(() => undefined);
    const split = splitProposedGoalSources(input.goalSources, projectReal, owner.proposal ? input.reviewedSourcePaths ?? [] : sourcePaths);
    if (split.refused) {
      return {
        ok: false, code: 'SOURCE_NOT_ALLOWED',
        message: owner.proposal
          ? `The goal names ${split.refused.exactPath}, which is outside this project and was not listed in the proposal's sources, so the card did not show it. `
            + 'The agent must list it in the proposal\'s `sources` (the user then sees it on the card before Launch), or remove it from the goal.'
          : `The goal names ${split.refused.exactPath}, which is outside this project and was not listed in sources. List it in \`sources\`, or remove it from the goal.`
      } as TeamJobLaunchResponse;
    }
    goalSourceDescriptors = split.attach;
    redactedGoalSources = split.known;
  }
  // Mint identity before snapshotting: source content lands in a dedicated,
  // immutable content store and execution ledger carries only bounded metadata.
  const launchRequestId = deps.newLaunchRequestId();
  const snapshot = await deps.snapshotSources(ctx.sources, {
    projectId: project.id, launchRequestId, sourceCapabilityIds: input.sourceCapabilityIds, sourcePaths, goalSourceDescriptors,
    // Re-checked against the realpath issue() takes, so a symlink swapped in after discovery can't escape.
    policy: await resolveSourcePolicy(deps.realpath, { projectRoot: project.path, ...deps.sourceBases() })
  });
  if (!snapshot.ok) return snapshot;
  const { sourceBundle } = snapshot;
  let started = false;
  try {
    const built = await buildSquadStartRequest(deps, {
      teamId: input.teamId, projectId: project.id, projectName: project.name, launchRequestId,
      coordinationMode: input.coordinationMode, slots: input.slots, attended: ctx.sources?.kind === 'window',
      goal: input.goal, title: input.title, summary: input.summary, completionInboxNotice: input.completionInboxNotice,
      sourceBundle, goalSourceDescriptors: redactedGoalSources,
      ...(targetCheck.target ? { target: targetCheck.target } : {})
    });
    if (!built.ok) return built.response;
    const result = owner.proposal || owner.reportTo
      ? await deps.squadExecutionService.start(owner.principalId, project.id, built.request, {
        ...(owner.proposal ? { proposal: owner.proposal } : {}),
        ...(owner.reportTo ? { reportTo: owner.reportTo } : {})
      })
      : await deps.squadExecutionService.start(owner.principalId, project.id, built.request);
    if (!result.ok) return teamJobFailureResponse(result);
    started = true;
    return { ok: true, value: { executionId: result.value.id, state: result.value.state } };
  } finally {
    if (!started) await discardLaunch(deps, launchRequestId, sourceBundle);
  }
}

/** Undo what a launch that did not start left behind; a cleanup failure must not mask the launch's own outcome. */
async function discardLaunch(deps: SquadLaunchDeps, launchRequestId: string, sourceBundle: SquadSourceBundle | undefined): Promise<void> {
  try {
    deps.planCorrectionLaunchBinding.forgetLaunch(launchRequestId);
  } catch (error) {
    deps.log?.('launch binding cleanup failed', error);
  }
  if (!sourceBundle) return;
  try {
    await deps.removeSnapshot(sourceBundle.contentRef);
  } catch (error) {
    deps.log?.('source snapshot cleanup failed', error);
  }
}

export function redactCapturedExecutionSourcePaths(text: string | undefined, descriptors: readonly ExecutionSourcePathDescriptor[]): string | undefined {
  if (text === undefined) return undefined;
  const paths = descriptors.flatMap(({ representations }) => representations)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort((left, right) => right.length - left.length);
  return paths.reduce((sanitized, path) => sanitized.split(path).join(`[captured execution source: ${basename(path)}]`), text);
}

/**
 * Redact captured source paths, resolve the plan and build the Squad start request. An
 * invalid provided plan parks for correction (attended) or is refused (unattended).
 */
async function buildSquadStartRequest(deps: SquadLaunchDeps, args: {
  teamId: string;
  projectId: string;
  projectName: string;
  launchRequestId: string;
  coordinationMode: 'structured' | 'freeform';
  slots: readonly Pick<ExpandedTeamSlot, 'role'>[];
  attended: boolean;
  goal: string;
  title?: string;
  summary?: string;
  completionInboxNotice: boolean;
  sourceBundle?: SquadSourceBundle;
  goalSourceDescriptors: ExecutionSourcePathDescriptor[];
  target?: SquadExecutionTargetSelector;
}): Promise<{ ok: true; request: ExecutionRequestV1 } | { ok: false; response: TeamJobLaunchResponse }> {
  const { sourceBundle, launchRequestId } = args;
  const capturedPathDescriptors = [...(sourceBundle?.pathDescriptors ?? []), ...args.goalSourceDescriptors];
  const sanitizedGoal = redactCapturedExecutionSourcePaths(args.goal, capturedPathDescriptors) ?? args.goal;
  const sanitizedExplicitTitle = redactCapturedExecutionSourcePaths(args.title, capturedPathDescriptors)?.slice(0, 256) || undefined;
  const sanitizedSummary = redactCapturedExecutionSourcePaths(args.summary, capturedPathDescriptors) || undefined;
  // Measure the redacted text the store receives; refuse it rather than cut it.
  const textProblem = squadLaunchTextProblem({ goal: sanitizedGoal, summary: sanitizedSummary });
  if (textProblem) {
    // The composer counts the raw goal; say so when redaction is what pushed it over.
    const message = textProblem.code === 'GOAL_TOO_LONG' && sanitizedGoal.length !== args.goal.length
      ? squadGoalTooLongMessage(sanitizedGoal.length, { afterSourceNames: true })
      : textProblem.message;
    return { ok: false, response: { ok: false, code: textProblem.code, message } };
  }
  const sourceMetadata = sourceBundle?.sources.map(({ extractedText: _content, ...metadata }) => metadata);
  // One resolver for interactive and triggered launches: "Plan provided in goal"
  // (structured) must yield a complete durable DAG or park for plan correction;
  // "Infer plan from goal" (freeform) leaves planning to the coordinator.
  const resolvedPlan = resolveSquadPlan(
    args.coordinationMode === 'structured' ? 'provided' : 'infer',
    [...(sourceBundle?.sources ?? []).map((source) => source.extractedText), args.goal]
  );
  const plannedWorkUnits = resolvedPlan.workUnits;
  const providedPlanError = resolvedPlan.planError;
  const planRefusal = await gateInvalidProvidedPlan(
    { inboxStore: deps.inboxStore, planCorrectionLaunchBinding: deps.planCorrectionLaunchBinding },
    { planError: providedPlanError, unattended: !args.attended, projectId: args.projectId, projectName: args.projectName, launchRequestId }
  );
  if (planRefusal) return { ok: false, response: planRefusal };
  const sanitizedJobTitle = await deps.nameTeamExecution(
    launchRequestId, sanitizedGoal, sanitizedExplicitTitle,
    sourceBundle?.sources.map((source) => redactCapturedExecutionSourcePaths(source.extractedText, capturedPathDescriptors))
  );
  const sharedTask = [
    `Shared job goal: ${sanitizedGoal}`,
    sanitizedSummary ? `Context: ${sanitizedSummary}` : '',
    providedPlanError ? PlanCorrectionService.correctionPrompt(providedPlanError) : '',
    planNormalizationNote(resolvedPlan.idRenames),
    'Work toward this goal. Coordinate through the Team orchestrator when one is present.'
  ].filter(Boolean).join('\n\n');
  const initialTask = args.slots.map((slot) => ({
    initialTask: slot.role === 'orchestrator'
      ? `${sharedTask}\n\nCoordinate workers, delegate role-specific work, and explicitly report execution completion with a summary when goal is met.`
      : `${sharedTask}\n\nCheck orchestrator instructions and report progress or blockers to it.`
  }));
  const autonomousTimeoutMs = deps.autonomousTimeoutMs();
  return {
    ok: true,
    request: {
      version: 1,
      teamId: args.teamId,
      launchRequestId,
      coordinationMode: args.coordinationMode,
      origin: 'explicit',
      jobTitle: sanitizedJobTitle,
      objective: sanitizedGoal,
      summary: sanitizedSummary,
      completionInboxNotice: args.completionInboxNotice,
      slots: initialTask,
      ...(plannedWorkUnits ? { workUnits: plannedWorkUnits } : {}),
      ...(args.target ? { target: args.target } : {}),
      ...(sourceBundle && sourceMetadata ? { sourceBundle: { contentRef: sourceBundle.contentRef, sources: sourceMetadata } } : {}),
      policy: {
        ...(autonomousTimeoutMs === 0 ? {} : { deadlineMs: autonomousTimeoutMs ?? AUTONOMOUS_DEFAULTS.timeoutMs })
      }
    }
  };
}
