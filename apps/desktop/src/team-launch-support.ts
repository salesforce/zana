import { join } from 'node:path';
import type { LaunchProfileId, Persona, Project, Team, TeamJobLaunchResponse, TeamJobRenewedSources } from '@zana-ai/zcc-domain/product';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';
import type { InboxInput } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import { compatibleNativeRecoverySnapshots, nativeRecoveryLaunchSlot } from './team-native-recovery.js';

type NativeRecoverySnapshots = NonNullable<ExecutionRecord['nativeRecoverySnapshots']>;

/**
 * Native-recovery projection for one Team slot. `nativeRecovery` is the main-issued
 * snapshot for the slot (never renderer-supplied); the slot identity fence lives in
 * `nativeRecoveryLaunchSlot`.
 */
export function slotRecoveryLaunch(input: {
  nativeRecovery?: object;
  slotId: string;
  role: 'worker' | 'orchestrator';
  personaId: string;
  profile: LaunchProfileId;
}) {
  const { nativeRecovery, ...slot } = input;
  return nativeRecoveryLaunchSlot({
    recovery: nativeRecovery ? { mode: 'exact-native', slots: [{ slotId: input.slotId, ...nativeRecovery } as never] } : undefined,
    ...slot
  });
}

export interface DesktopNativeRecoveryDeps {
  projects: { listProjects(): Project[] };
  teams: { list(): Team[] };
  personas: { list(): Persona[] };
  expandTeamSlots(team: Team): ReadonlyArray<{ slotId: string; role: 'worker' | 'orchestrator'; personaId: string }>;
  resolveTeamProfile(project: Project, personas: readonly Persona[], persona: Persona): LaunchProfileId;
}

/** Trusted desktop-only exact-native snapshots. Native ids never leave main/service. */
export function createDesktopNativeRecovery(deps: DesktopNativeRecoveryDeps) {
  function compatibleSnapshots(record: ExecutionRecord): NativeRecoverySnapshots {
    const project = deps.projects.listProjects().find((candidate) => candidate.id === record.projectId);
    const team = deps.teams.list().find((candidate) => candidate.id === record.teamId);
    const snapshots = record.nativeRecoverySnapshots ?? [];
    if (!project || !team || snapshots.length === 0) return [];
    const personaSnapshot = deps.personas.list();
    const personasById = new Map(personaSnapshot.map((persona) => [persona.id, persona]));
    const slots = deps.expandTeamSlots(team).flatMap((slot) => {
      const persona = personasById.get(slot.personaId);
      return persona ? [{ ...slot, profile: deps.resolveTeamProfile(project, personaSnapshot, persona) }] : [];
    });
    return compatibleNativeRecoverySnapshots({ snapshots, slots });
  }
  function availability(record: ExecutionRecord): { available: boolean; restorableSlots: number } {
    const snapshots = compatibleSnapshots(record);
    return { available: snapshots.length > 0, restorableSlots: snapshots.length };
  }
  return { compatibleSnapshots, availability };
}

interface UnitRequires { requires?: { skills?: string[]; mcpServers?: string[] } }

/**
 * Capability requirements a Squad admission check must verify. Persona MCP servers
 * stay the budgeted requirement; work-unit MCP servers widen the inventory probe only.
 */
export function teamAdmissionRequirements(
  slotPersonas: ReadonlyArray<Pick<Persona, 'mcpServers'>>,
  workUnits: ReadonlyArray<UnitRequires> | undefined
): { requiredSkills: string[]; personaMcpServers: string[]; inventoryMcpServers: string[] } {
  const units = workUnits ?? [];
  const personaServers = slotPersonas.flatMap((persona) => persona.mcpServers ?? []);
  return {
    requiredSkills: [...new Set(units.flatMap((unit) => unit.requires?.skills ?? []))].sort(),
    personaMcpServers: [...new Set(personaServers)].sort(),
    inventoryMcpServers: [...new Set([...personaServers, ...units.flatMap((unit) => unit.requires?.mcpServers ?? [])])].sort()
  };
}

type FailedLaunch = {
  code: string;
  message: string;
  availabilityUnknown?: unknown;
  requirementFailure?: unknown;
};

/** Map a failed Squad start onto the typed Team-job UI response. */
export function teamJobFailureResponse(result: FailedLaunch): TeamJobLaunchResponse {
  if (result.availabilityUnknown) {
    return { ok: false, code: 'CAPABILITY_AVAILABILITY_UNKNOWN', message: result.message, availabilityUnknown: result.availabilityUnknown } as TeamJobLaunchResponse;
  }
  if (result.requirementFailure) {
    return { ok: false, code: 'REQUIREMENT_UNAVAILABLE', message: result.message, requirementFailure: result.requirementFailure } as TeamJobLaunchResponse;
  }
  return { ok: false, code: result.code, message: result.message } as TeamJobLaunchResponse;
}

export interface ProposalLaunchDeps<P> {
  beginLaunch(proposalId: string, projectId: string): Promise<{ ok: true; value: { proposal: P } } | { ok: false; code: string; message: string }>;
  markLaunched(proposalId: string, executionId: string): Promise<void>;
  releaseLaunch(proposalId: string): void;
  logError(context: string, error: unknown): void;
}

/**
 * Hold a proposal for exactly one launch. `start` receives the proposal (undefined for an
 * ordinary launch). Every exit before a Squad starts (a refused source or plan, a failed or
 * throwing start) releases the hold so the user can retry at once; a started Squad is
 * recorded and never launched again from the same proposal.
 */
export async function withProposalLaunch<P>(
  deps: ProposalLaunchDeps<P>,
  proposalId: string | undefined,
  projectId: string,
  start: (proposal: P | undefined) => Promise<TeamJobLaunchResponse>
): Promise<TeamJobLaunchResponse> {
  if (proposalId === undefined) return start(undefined);
  const begun = await deps.beginLaunch(proposalId, projectId);
  if (!begun.ok) return { ok: false, code: begun.code, message: begun.message } as TeamJobLaunchResponse;
  let launched = false;
  try {
    const response = await start(begun.value.proposal);
    if (response.ok) {
      launched = true;
      // The Squad is already running; a ledger failure is logged, never surfaced as a failed launch.
      try { await deps.markLaunched(proposalId, response.value.executionId); }
      catch (error) { deps.logError(`squad proposal ${proposalId} markLaunched`, error); }
    }
    return response;
  } finally {
    if (!launched) deps.releaseLaunch(proposalId);
  }
}

/** Newest executions first, bounded to 5 pages (Rule 5); a proposal's run is always recent. */
export async function findProposalExecution(
  store: { listInProject(projectId: string, before?: number, limit?: number): Promise<{ records: ExecutionRecord[]; hasMore: boolean }> },
  projectId: string,
  proposalId: string
): Promise<string | undefined> {
  let before: number | undefined;
  for (let page = 0; page < 5; page += 1) {
    const { records, hasMore } = await store.listInProject(projectId, before, 100);
    const match = records.find((record) => record.proposal?.id === proposalId);
    if (match) return match.id;
    if (!hasMore || records.length === 0) return undefined;
    before = records[records.length - 1]!.createdAt;
  }
  return undefined;
}

export interface ProvidedPlanGateDeps {
  inboxStore: { append(input: InboxInput): Promise<unknown> };
  planCorrectionLaunchBinding: { beginLaunch(launchRequestId: string, reason: string): void };
}

/**
 * An invalid "Plan provided in goal" either parks for operator correction (attended
 * launch) or, when no operator window launched it, notifies and refuses.
 * Returns the refusal response, or undefined to continue launching.
 */
export async function gateInvalidProvidedPlan(
  deps: ProvidedPlanGateDeps,
  args: { planError: string | undefined; unattended: boolean; viaTrigger?: boolean; projectId: string; projectName: string; launchRequestId: string }
): Promise<TeamJobLaunchResponse | undefined> {
  if (!args.planError) return undefined;
  if (args.unattended) {
    await deps.inboxStore.append({
      projectId: args.projectId,
      projectLabel: args.projectName,
      subject: 'Squad plan needed correction',
      comments: args.viaTrigger
        ? `Provided Squad plan is invalid: ${args.planError}. Update plan, then run trigger again.`
        : `Provided Squad plan is invalid: ${args.planError}. Put a complete plan in the goal and launch again, or launch with the infer (freeform) mode to let the coordinator plan.`,
      notify: 'loud'
    });
    return { ok: false, code: 'INVALID_PLAN', message: 'provided structured plan is invalid' } as TeamJobLaunchResponse;
  }
  deps.planCorrectionLaunchBinding.beginLaunch(args.launchRequestId, args.planError);
  return undefined;
}

export interface RetainedWorktreeSweepDeps {
  executionStore: { listUndisposedSquadWorktrees(): Promise<Array<{ projectId: string; squadWorktree?: { path: string } }>> };
  projects: { listProjects(): Array<{ id: string; path: string; remote?: unknown }> };
  sweepManagedWorktrees(projectPath: string, base: string, retained: string[]): Promise<unknown>;
  logError(context: string, error: unknown): void;
}

/**
 * Boot cleanup of managed worktrees no live or resumable execution owns. The sweep
 * helper itself requires Zana's hook marker and a clean, no-unique-commit checkout.
 */
export async function sweepUnretainedSquadWorktrees(deps: RetainedWorktreeSweepDeps): Promise<void> {
  try {
    const retainedWorktrees = await deps.executionStore.listUndisposedSquadWorktrees();
    for (const project of deps.projects.listProjects()) {
      if (project.remote) continue;
      const retained = retainedWorktrees
        .filter((record) => record.projectId === project.id)
        .flatMap((record) => record.squadWorktree ? [record.squadWorktree.path] : []);
      await deps.sweepManagedWorktrees(project.path, join(project.path, '.worktrees'), retained);
    }
  } catch (err) {
    deps.logError('squadWorktree.bootSweep', err);
  }
}

/** Boot recovery order: follow-up claims, terminal replay, deadlines, plan corrections. */
export async function recoverSquadStateAtBoot(deps: {
  squadFollowUpClaims: { restoreSurvivingClaims(): Promise<void> };
  squadWorktreeRuntime: { replayUndisposedTerminalEffects(): Promise<void> };
  squadExecutionService: { restoreDeadlines(): Promise<unknown> };
  planCorrection: { recoverCancelledExecutions(): Promise<Array<{ executionId: string; error: unknown }>> };
  logError(context: string, error: unknown): void;
}): Promise<void> {
  // Rebuild retained follow-up ownership before recovery can resume, merge, or
  // delete worktrees. Renderer reattach repeats this under the same lock.
  await deps.squadFollowUpClaims.restoreSurvivingClaims();
  await deps.squadWorktreeRuntime.replayUndisposedTerminalEffects();
  await deps.squadExecutionService.restoreDeadlines();
  for (const { executionId, error } of await deps.planCorrection.recoverCancelledExecutions()) {
    deps.logError(`planCorrection.recoverCancelledExecutions:${executionId}`, error);
  }
}

/** Spawn wrapper: run `spawn` inside the optional lifecycle lock. */
export function runSpawnLifecycle<T>(
  lifecycle: { withSpawnLock?: <R>(spawn: () => Promise<R>) => Promise<R> } | undefined,
  spawn: () => Promise<T>
): Promise<T> {
  return lifecycle?.withSpawnLock ? lifecycle.withSpawnLock(spawn) : spawn();
}

type ScopedSourceInput = { windowId: number; projectId: string; capabilityIds: string[] };

/** Bind the registry's re-issue and discard to one window and Project for `withRenewedSources`. */
export function scopedSourceRenewal(
  registry: { reissue(input: ScopedSourceInput): Promise<TeamJobRenewedSources>; discardRetired(input: ScopedSourceInput): void },
  windowId: number | undefined,
  projectId: string
): { reissue: (ids: string[]) => Promise<TeamJobRenewedSources>; discardRetired: (ids: string[]) => void } {
  // Ids reach the helper only from a trusted window (startTeamJobFromUi checks this first).
  return {
    reissue: (ids) => registry.reissue({ windowId: windowId!, projectId, capabilityIds: ids }),
    discardRetired: (ids) => registry.discardRetired({ windowId: windowId!, projectId, capabilityIds: ids })
  };
}

/** Ids of launches still running, so an overlapping launch cannot trade a replayed id for a new one. */
const inFlightSourceIds = new Set<string>();
/** In-flight ids another launch also submitted; whichever launch consumed them, neither may renew them. */
const contestedSourceIds = new Set<string>();

/**
 * A failed launch may already have consumed the attached source capabilities, so the
 * renderer would be left with dead chips. Hand back freshly re-issued ones with every
 * failure; a throwing launch with attachments becomes a LAUNCH_FAILED response.
 * A second launch that reuses ids of one still running gets its failure back unchanged,
 * and the first then renews nothing either, whichever of the two consumed the ids.
 */
export async function withRenewedSources(
  launch: () => Promise<TeamJobLaunchResponse>,
  capabilityIds: readonly string[],
  reissue: (ids: string[]) => Promise<TeamJobRenewedSources>,
  logError: (context: string, error: unknown) => void,
  discardRetired?: (ids: string[]) => void
): Promise<TeamJobLaunchResponse> {
  const overlapping = capabilityIds.some((id) => inFlightSourceIds.has(id));
  const owned = overlapping ? [] : [...new Set(capabilityIds)];
  for (const id of owned) inFlightSourceIds.add(id);
  if (overlapping) for (const id of capabilityIds) if (inFlightSourceIds.has(id)) contestedSourceIds.add(id);
  try {
    let failure: Exclude<TeamJobLaunchResponse, { ok: true }>;
    try {
      const result = await launch();
      if (result.ok) {
        // The files were consumed for good; forget them so a replayed id cannot be exchanged for a new one.
        if (capabilityIds.length) {
          try { discardRetired?.([...capabilityIds]); } catch (error) { logError('team-job-discard-sources', error); }
        }
        return result;
      }
      if (!capabilityIds.length) return result;
      failure = result;
    } catch (error) {
      if (!capabilityIds.length) throw error;
      logError('team-job-launch', error);
      failure = { ok: false, code: 'LAUNCH_FAILED', message: error instanceof Error ? error.message : String(error) };
    }
    if (overlapping || owned.some((id) => contestedSourceIds.has(id))) return failure;
    try {
      return { ...failure, sources: await reissue([...capabilityIds]) };
    } catch (error) {
      logError('team-job-renew-sources', error);
      return failure;
    }
  } finally {
    for (const id of owned) { inFlightSourceIds.delete(id); contestedSourceIds.delete(id); }
  }
}
