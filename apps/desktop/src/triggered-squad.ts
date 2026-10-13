import type { Persona, Project, Team } from '@zana-ai/zcc-domain/product';
import type { SquadExecutionService } from '@zana-ai/zcc-server/services/execution/service';
import { invalidProvidedPlanHold, resolveTriggeredSquadPlan } from './team-trigger-semantics.js';
import { startTriggeredSquadExecution, triggeredSquadSlotTasks } from './scheduled-plan-correction.js';

export interface TriggeredSquadInput {
  projectId: string;
  callerPrincipalId: string;
  teamId: string;
  launchRequestId: string;
  objective: string;
  title: string;
  planSource: 'provided' | 'infer';
  origin: 'scheduled' | 'goal';
  maxDurationMinutes?: number;
}

export interface TriggeredSquadDeps {
  projects: { listProjects(): Project[] };
  teams: { list(): Team[] };
  personas: { list(): Persona[] };
  /** Why the Team's host cannot run it, if it cannot. */
  teamHostProblem(project: Project): string | undefined;
  expandTeamSlots(team: Team): ReadonlyArray<{ role: 'orchestrator' | 'worker' }>;
  /** The Squad execution service (or any `start` provider). */
  squadExecutionService: Pick<SquadExecutionService, 'start'>;
  planCorrectionLaunchBinding: { beginLaunch(launchRequestId: string, reason: string): void; forgetLaunch(launchRequestId: string): void };
}

/**
 * Start a Squad on behalf of a schedule or goal. main re-resolves the project, Team
 * and orchestrator itself; the trigger only supplies ids and an objective.
 */
export function createTriggeredSquadLauncher(deps: TriggeredSquadDeps) {
  return async function startTriggeredSquad(input: TriggeredSquadInput): Promise<{ executionId: string }> {
    const project = deps.projects.listProjects().find(candidate => candidate.id === input.projectId);
    const team = deps.teams.list().find(candidate => candidate.id === input.teamId);
    if (!project) throw new Error('project not found');
    if (!team) throw new Error('team not found');
    if (deps.teamHostProblem(project)) throw new Error('team host is unavailable');
    if (!team.orchestratorPersonaId || !deps.personas.list().some(persona => persona.id === team.orchestratorPersonaId)) throw new Error('team requires an available orchestrator');
    const slots = deps.expandTeamSlots(team);
    if (!slots.length || slots.length > 32) throw new Error('team has no launchable slots');
    const { coordinationMode, workUnits, planError } = resolveTriggeredSquadPlan(input.planSource, input.objective);
    // An invalid supplied plan follows the same parked-Squad correction path as an
    // interactive provided plan (binding begun in triggeredSquadSlotTasks): the
    // durable execution gives Inbox a real run to open; no Claude fallback agent
    // is created and workers wait for the corrected plan.
    // A failed start forgets the launch binding begun by triggeredSquadSlotTasks.
    return startTriggeredSquadExecution(input.launchRequestId, () => deps.squadExecutionService.start(input.callerPrincipalId, project.id, {
      version: 1, teamId: team.id, launchRequestId: input.launchRequestId, coordinationMode, origin: input.origin,
      jobTitle: input.title, objective: input.objective,
      slots: triggeredSquadSlotTasks(input, slots, planError, invalidProvidedPlanHold, deps.planCorrectionLaunchBinding),
      ...(workUnits ? { workUnits } : {}),
      ...(input.maxDurationMinutes && input.maxDurationMinutes > 0 ? { policy: { deadlineMs: input.maxDurationMinutes * 60 * 1000 } } : {})
    }), deps.planCorrectionLaunchBinding);
  };
}

/** Scheduler `launchSquad` adapter input. The Team id is validated by the launcher. */
export function scheduledSquadInput(args: {
  schedule: { id: string; name: string; teamId?: string; planSource?: 'provided' | 'infer'; maxDurationMinutes?: number };
  project: { id: string };
  runId: string;
  objective: string;
}): TriggeredSquadInput {
  const { schedule, project, runId, objective } = args;
  return {
    projectId: project.id, callerPrincipalId: `schedule:${project.id}`, teamId: schedule.teamId!, launchRequestId: `schedule:${schedule.id}:${runId}`,
    objective,
    title: `Scheduled: ${schedule.name}`, planSource: schedule.planSource ?? 'infer',
    origin: 'scheduled',
    maxDurationMinutes: schedule.maxDurationMinutes
  };
}

/** Goal-loop `launchSquad` adapter input. */
export function goalSquadInput(args: {
  goal: { id: string; title: string; statement: string; planSource?: 'provided' | 'infer'; assignment: { teamId?: string } };
  project: { id: string };
  iterationId: string;
}): TriggeredSquadInput {
  const { goal, project, iterationId } = args;
  return {
    projectId: project.id, callerPrincipalId: `goal:${project.id}`, teamId: goal.assignment.teamId!, launchRequestId: `goal:${goal.id}:${iterationId}`,
    objective: goal.statement, title: `Goal: ${goal.title}`, planSource: goal.planSource ?? 'infer', origin: 'goal'
  };
}

interface ObservedExecution {
  id: string;
  state: string;
  finalSummary?: string;
  launchRequestId?: string;
}

/**
 * Read-only observers a trigger uses to follow its Squad run. `findSquadExecution`
 * is scoped to the trigger's own principal, so one trigger cannot see another's runs.
 */
export function createSquadObservers(
  executionStore: {
    getInProject(projectId: string, executionId: string): Promise<ObservedExecution | undefined>;
    list(principalId: string, projectId: string): Promise<ObservedExecution[]>;
  },
  owner: 'schedule' | 'goal'
) {
  return {
    getSquadExecution: async (projectId: string, executionId: string) => {
      const record = await executionStore.getInProject(projectId, executionId);
      return record ? { state: record.state, finalSummary: record.finalSummary } : undefined;
    },
    findSquadExecution: async (projectId: string, launchRequestId: string) => {
      const records = await executionStore.list(`${owner}:${projectId}`, projectId);
      const record = records.find(candidate => candidate.launchRequestId === launchRequestId);
      return record ? { executionId: record.id, state: record.state, finalSummary: record.finalSummary } : undefined;
    }
  };
}

type SquadObserverStore = Parameters<typeof createSquadObservers>[0];
type StartTriggeredSquad = (input: TriggeredSquadInput) => Promise<{ executionId: string }>;

/** Scheduler dependency bundle: launch plus read-only run observers scoped to schedules. */
export function scheduledSquadTrigger(startTriggeredSquad: StartTriggeredSquad, executionStore: SquadObserverStore) {
  return {
    launchSquad: (args: Parameters<typeof scheduledSquadInput>[0]) => startTriggeredSquad(scheduledSquadInput(args)),
    ...createSquadObservers(executionStore, 'schedule')
  };
}

/** Goal-loop dependency bundle: launch plus read-only run observers scoped to goals. */
export function goalSquadTrigger(startTriggeredSquad: StartTriggeredSquad, executionStore: SquadObserverStore) {
  return {
    launchSquad: (args: Parameters<typeof goalSquadInput>[0]) => startTriggeredSquad(goalSquadInput(args)),
    ...createSquadObservers(executionStore, 'goal')
  };
}
