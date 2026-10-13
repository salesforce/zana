import { join } from 'node:path';
import type { LaunchProfileId, Persona, Project, Team, TeamJobLaunchResponse } from '@zana-ai/zcc-domain/product';
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
  args: { planError: string | undefined; unattended: boolean; projectId: string; projectName: string; launchRequestId: string }
): Promise<TeamJobLaunchResponse | undefined> {
  if (!args.planError) return undefined;
  if (args.unattended) {
    await deps.inboxStore.append({
      projectId: args.projectId,
      projectLabel: args.projectName,
      subject: 'Squad plan needed correction',
      comments: 'Provided Squad plan is invalid. Update plan, then run trigger again.',
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
