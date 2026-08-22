import { describe, expect, it } from 'vitest';
import { projectExecutionProjection } from '../execution/projection.js';
import type { ExecutionRecord } from '../execution/store.js';
import type { TerminalSession } from '../../shared/types.js';

function record(): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Release train', requestDigest: 'digest', launchRequestId: 'request', teamLaunchRequestId: 'team-request', request: { version: 1, slots: [{ initialTask: 'Ship' }], resolvedModels: [] }, attempt: 2, state: 'RUNNING', stateVersion: 3, resolvedModels: [], createdAt: 1, updatedAt: 2
  };
}

describe('projectExecutionProjection', () => {
  it('projects non-secret project execution state and finds only a live orchestrator', () => {
    const session = { id: 'orch', status: 'running', cohort: { executionId: 'execution-1', role: 'orchestrator' } } as TerminalSession;
    expect(projectExecutionProjection([record()], [session])).toEqual([{
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Release train', state: 'RUNNING', attempt: 2, stateVersion: 3, updatedAt: 2, orchestratorSessionId: 'orch'
    }]);
  });

  it('does not claim an exited orchestrator as live', () => {
    const session = { id: 'orch', status: 'exited', cohort: { executionId: 'execution-1', role: 'orchestrator' } } as TerminalSession;
    expect(projectExecutionProjection([record()], [session])[0].orchestratorSessionId).toBeUndefined();
  });
});
