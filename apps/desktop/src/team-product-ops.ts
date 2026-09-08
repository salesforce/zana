import { randomUUID } from 'node:crypto';
import type { Result, TeamJobLaunchInput } from '@zana-ai/zcc-domain/product';
import type {
  ProductTeamLaunchInput,
  ProductTeamLaunchResult,
  ProductTeamOps,
  ProductTeamStatus
} from '@zana-ai/zcc-server/http/product-context';
import { executionBoardProjection } from '@zana-ai/zcc-server/services/execution/projection';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';

export interface TeamProductOpDeps {
  startTeamJobFromUi(input: TeamJobLaunchInput): Promise<Result<{ executionId: string; state: string }>>;
  launchAutonomousTeam(teamId: string, projectId: string, goal: string): Promise<Result<{ runId: string }>>;
  stopAutonomousRun(runId: string): Result<true>;
  listAutonomousRuns(): Array<{
    runId: string;
    teamId: string;
    projectId: string;
    goal: string;
    state: string;
    summary?: string;
  }>;
  getExecution(executionId: string): Promise<ExecutionRecord | undefined>;
  snapshot(owner: string, projectId: string, executionId: string): Promise<{ execution: ExecutionRecord } | undefined>;
  stopJob(owner: string, projectId: string, executionId: string, expectedStateVersion: number): Promise<Result<ExecutionRecord>>;
  respondToBlocker(
    owner: string,
    projectId: string,
    executionId: string,
    expectedStateVersion: number,
    blockerId: string,
    clientRequestId: string,
    message: string
  ): Promise<Result<ExecutionRecord>>;
}

function jobStatus(record: ExecutionRecord): ProductTeamStatus {
  const projection = executionBoardProjection(record);
  return {
    kind: 'job',
    id: record.id,
    projectId: record.projectId,
    teamId: record.teamId,
    state: record.state,
    stateVersion: record.stateVersion,
    ...(projection.goal ? { goal: projection.goal } : {}),
    ...(projection.summary ? { summary: projection.summary } : {}),
    blockers: (record.blockers ?? []).map((blocker) => ({
      id: blocker.id,
      question: blocker.question,
      resolved: blocker.resolved
    }))
  };
}

function runStatus(run: {
  runId: string;
  teamId: string;
  projectId: string;
  goal: string;
  state: string;
  summary?: string;
}): ProductTeamStatus {
  return {
    kind: 'run',
    id: run.runId,
    projectId: run.projectId,
    teamId: run.teamId,
    state: run.state,
    goal: run.goal,
    ...(run.summary ? { summary: run.summary } : {})
  };
}

export function createTeamProductOps(deps: TeamProductOpDeps): ProductTeamOps {
  const find = async (id: string) => {
    const execution = await deps.getExecution(id);
    if (execution) return { kind: 'job' as const, execution };
    const run = deps.listAutonomousRuns().find((candidate) => candidate.runId === id);
    if (run) return { kind: 'run' as const, run };
    return undefined;
  };

  return {
    async launch(input: ProductTeamLaunchInput) {
      if (input.mode === 'structured') {
        const started = await deps.startTeamJobFromUi({
          teamId: input.teamId,
          projectId: input.projectId,
          goal: input.goal,
          ...(input.title ? { title: input.title } : {}),
          ...(input.summary ? { summary: input.summary } : {})
        });
        return started.ok
          ? { ok: true, value: { kind: 'job', id: started.value.executionId, state: started.value.state } }
          : started;
      }
      const started = await deps.launchAutonomousTeam(input.teamId, input.projectId, input.goal);
      return started.ok
        ? { ok: true, value: { kind: 'run', id: started.value.runId, state: 'running' } }
        : started;
    },

    async status(id: string) {
      const found = await find(id);
      if (!found) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      if (found.kind === 'run') return { ok: true, value: runStatus(found.run) };
      const snapshot = await deps.snapshot(found.execution.callerPrincipalId, found.execution.projectId, found.execution.id);
      if (!snapshot) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      return { ok: true, value: jobStatus(snapshot.execution) };
    },

    async answer(input) {
      const found = await find(input.id);
      if (!found) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      if (found.kind === 'run') {
        return {
          ok: false,
          code: 'UNAVAILABLE',
          message: 'answer is not available for autonomous runs until the Auto/Job merge'
        };
      }
      const open = (found.execution.blockers ?? []).filter((blocker) => !blocker.resolved);
      const blockerId = input.blockerId ?? (open.length === 1 ? open[0]!.id : '');
      if (!blockerId) {
        return { ok: false, code: 'INVALID', message: 'blockerId is required when multiple blockers are open' };
      }
      const expected = input.expectedStateVersion ?? found.execution.stateVersion;
      const result = await deps.respondToBlocker(
        found.execution.callerPrincipalId,
        found.execution.projectId,
        found.execution.id,
        expected,
        blockerId,
        randomUUID(),
        input.message
      );
      return result.ok
        ? { ok: true, value: jobStatus(result.value) }
        : { ok: false, code: result.code, message: result.message };
    },

    async stop(id, expectedStateVersion) {
      const found = await find(id);
      if (!found) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      if (found.kind === 'run') {
        const stopped = deps.stopAutonomousRun(found.run.runId);
        if (!stopped.ok) return stopped;
        const after = deps.listAutonomousRuns().find((candidate) => candidate.runId === id);
        return { ok: true, value: after ? runStatus(after) : true };
      }
      const expected = expectedStateVersion ?? found.execution.stateVersion;
      const result = await deps.stopJob(
        found.execution.callerPrincipalId,
        found.execution.projectId,
        found.execution.id,
        expected
      );
      return result.ok
        ? { ok: true, value: jobStatus(result.value) }
        : { ok: false, code: result.code, message: result.message };
    }
  };
}

export function teamOpsResult(value: unknown): { ok: true; value: ProductTeamLaunchResult | ProductTeamStatus | true } | { ok: false; code: string; message: string } {
  if (!value || typeof value !== 'object') return { ok: false, code: 'INVALID', message: 'invalid team op result' };
  const record = value as { ok?: unknown; code?: unknown; message?: unknown; value?: unknown };
  if (record.ok === true) return { ok: true, value: record.value as ProductTeamLaunchResult | ProductTeamStatus | true };
  return {
    ok: false,
    code: typeof record.code === 'string' ? record.code : 'INVALID',
    message: typeof record.message === 'string' ? record.message : 'team op failed'
  };
}
