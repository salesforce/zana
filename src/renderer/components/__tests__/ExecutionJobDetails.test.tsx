import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Job detail UX contract', () => {
  it('renders durable job identity, sources, work, active blocker, artifacts, summary, and controls', () => {
    const project = readFileSync(new URL('../ProjectAgentsBoard.tsx', import.meta.url), 'utf8');
    expect(project).toContain('<ExecutionJobDetails');
    const detail = readFileSync(new URL('../ExecutionJobDetails.tsx', import.meta.url), 'utf8');
    for (const label of ['Job ·', 'Run ID', 'Kind', 'Job Team', 'Status', 'Goal', 'Summary', 'Team', 'Coordinator', 'Sources', 'Work units', 'Assignments', 'Progress', 'Current blocker', 'Respond', 'Artifacts', 'Final summary', 'Stop job', 'Retry job', 'Retry work', 'Release work', 'Reassign work', 'Recover coordinator', 'Pending delivery', 'Awaiting worker acknowledgement', 'Delivery failed', 'Delivered']) {
      expect(detail).toContain(label);
    }
    expect(detail).toContain('execution.executionId');
    expect(detail).toContain("assignment.state === 'FAILED' || assignment.state === 'BLOCKED'");
    expect(detail).toContain("assignment.state === 'CLAIMED'");
    expect(detail).toContain("assignment.state === 'READY'");
    expect(detail).toContain('snapshot.execution.currentBlocker');
    expect(detail).toContain('blocker.id');
    expect(detail).toContain('requestIdentityRef');
    expect(detail).toContain('blockerId: blocker.id, text: message');
    expect(detail).toContain('setReplyDraft(\'\')');
    expect(detail).toContain('refresh()');
    expect(detail).toContain("execution.recovery?.status === 'available'");
    expect(detail).not.toContain('execution.recoveryAttention && execution.hasResumeToken');
    expect(detail).toContain('Rotation creates a replacement credential');
    expect(detail).toContain('currentBlocker.delivery.retryEligible');
    expect(detail).toContain('executionBoard.retryDelivery');
    expect(detail).toContain("currentBlocker.delivery.state === 'PENDING'");
    expect(detail).toContain("currentBlocker.delivery.state === 'LEASED'");
    expect(detail).toContain('Answer queued; waiting for worker acknowledgement');
    expect(detail).toContain('aria-live="polite"');
    expect(detail).toContain('aria-atomic="true"');
    expect(detail).toContain('new TextEncoder().encode(replyDraft).byteLength');
    expect(detail).toContain('16 * 1024');
    expect(detail).not.toContain('maxLength={16_384}');
    expect(detail).not.toContain('Resume job');
    expect(detail).not.toContain('executionBoard.resume(');
    expect(detail).toContain('Job details unavailable');
    expect(detail).toContain('Close details');
    expect(detail).toContain('className="btn execution-details-close"');
    expect(detail).toContain('className="btn danger"');
    expect(detail).toContain('className="btn primary"');
    expect(detail).toContain('Job {execution.state.toLowerCase()}. This blocker is retained as history');
    expect(detail).toContain('!isTerminal && <>');
    const store = readFileSync(new URL('../../store.ts', import.meta.url), 'utf8');
    expect(store).toContain("tab.cohort?.role === 'worker'");
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    expect(css).toContain('.agents-board-content');
    expect(css).toContain('max-height: min(420px, 42%)');
    expect(css).not.toContain('max-height: min(720px, calc(100vh - 180px))');
  });

  it('uses recovery availability rather than cached-token presence on every board surface', () => {
    const board = readFileSync(new URL('../AgentBoard.tsx', import.meta.url), 'utf8');
    expect(board).toContain("execution.recovery?.status === 'available'");
    expect(board).not.toContain('execution.hasResumeToken && !exited');
  });

  it('opens retained jobs consistently from global board', () => {
    const global = readFileSync(new URL('../GlobalAgentsBoard.tsx', import.meta.url), 'utf8');
    const monitor = readFileSync(new URL('../AgentMonitor.tsx', import.meta.url), 'utf8');
    const flow = readFileSync(new URL('../SquadFlowView.tsx', import.meta.url), 'utf8');
    const detail = readFileSync(new URL('../ExecutionJobDetails.tsx', import.meta.url), 'utf8');
    expect(global).toContain('<ExecutionJobDetails');
    expect(detail).toContain('executionBoard.snapshot');
    expect(monitor).toContain('Respond in job details');
    expect(monitor).toContain('onInspectExecution(execution.projectId, execution.executionId)');
    expect(flow).toContain('node?.job?.executionId');
    expect(flow).toContain('onInspectExecution(graph.projectId, node.job.executionId)');
  });

  it('keeps durable executions visible without terminal cards and gives terminal jobs a context-menu dismiss', () => {
    const project = readFileSync(new URL('../ProjectAgentsBoard.tsx', import.meta.url), 'utf8');
    const global = readFileSync(new URL('../GlobalAgentsBoard.tsx', import.meta.url), 'utf8');
    const board = readFileSync(new URL('../AgentBoard.tsx', import.meta.url), 'utf8');
    expect(project).toContain("cards.length === 0 && executions.length === 0");
    expect(global).toContain("cards.length === 0 && executions.length === 0");
    expect(board).toContain('Inspect details');
    expect(board).toContain('window.cc.executionBoard.dismiss');
    expect(board).toContain('Dismiss');
    expect(board).toContain('execution && isOrchestrator');
    expect(board).toContain('cohort?.executionId');
    expect(board).toContain('Waiting for assignment');
    expect(board).toContain('dismissTerminals(result.value.dismissedSessionIds)');
    expect(project).toContain('agents-board-content');
    expect(global).toContain('agents-board-content');
    expect(project).toContain('setSelectedExecutionId((current) => current === executionId ? null : current)');
    expect(global).toContain('setSelectedExecution((current) => current?.executionId === executionId ? null : current)');
  });
});
