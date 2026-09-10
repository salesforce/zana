import { randomUUID } from 'node:crypto';
import type {
  ProductTeamLaunchInput,
  ProductTeamOps,
  ProductTeamStatus,
  Result,
  TeamJobLaunchInput
} from '@zana-ai/zcc-domain/product';
import {
  executionBoardProjection
} from '@zana-ai/zcc-server/services/execution/projection';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';

export interface TeamProductOpDeps {
  startTeamJobFromUi(input: TeamJobLaunchInput): Promise<Result<{ executionId: string; state: string }>>;
  getExecution(executionId: string): Promise<ExecutionRecord | undefined>;
  status(owner: string, projectId: string, executionId: string): Promise<ExecutionRecord | undefined>;
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
    ...(projection.objective ? { goal: projection.objective } : {}),
    ...(projection.summary ? { summary: projection.summary } : {}),
    blockers: (record.blockers ?? []).map((blocker) => ({
      id: blocker.id,
      question: blocker.question,
      resolved: blocker.resolved
    }))
  };
}

export function createTeamProductOps(deps: TeamProductOpDeps): ProductTeamOps {
  const find = async (id: string) => {
    const execution = await deps.getExecution(id);
    return execution ? { execution } : undefined;
  };

  return {
    async launch(input: ProductTeamLaunchInput) {
      const started = await deps.startTeamJobFromUi({
        teamId: input.teamId,
        projectId: input.projectId,
        goal: input.goal,
        coordinationMode: input.mode,
        ...(input.title ? { title: input.title } : {}),
        ...(input.summary ? { summary: input.summary } : {})
      });
      return started.ok
        ? { ok: true, value: { kind: 'job', id: started.value.executionId, state: started.value.state } }
        : started;
    },

    async status(id: string) {
      const found = await find(id);
      if (!found) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      const current = await deps.status(found.execution.callerPrincipalId, found.execution.projectId, found.execution.id);
      if (!current) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      return { ok: true, value: jobStatus(current) };
    },

    async answer(input) {
      const found = await find(input.id);
      if (!found) return { ok: false, code: 'NOT_FOUND', message: 'execution not found' };
      const open = (found.execution.blockers ?? []).filter((blocker) => !blocker.resolved);
      const blockerId = input.blockerId ?? (open.length === 1 ? open[0]!.id : '');
      if (!blockerId) {
        if (open.length === 0) return { ok: false, code: 'INVALID', message: 'no open blocker to answer' };
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
