import { describe, expect, it } from 'vitest';
import type { ThreadTimelineViewRow, TimelineViewWorkRow } from '@zana-ai/zcc-thread-view';
import {
  collectTimelineAutoExpansionRowIds,
  isNonExpandableSummary,
  isRowExpandable,
  isWorkRowExpandable
} from './timeline-auto-expand.js';

const base = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1
};

function command(status: 'pending' | 'completed', id = 'c1'): TimelineViewWorkRow {
  return {
    ...base,
    id,
    kind: 'work',
    workKind: 'command',
    status,
    callId: id,
    command: 'ls',
    cwd: null,
    source: null,
    output: 'a',
    exitCode: status === 'completed' ? 0 : null,
    completedAt: status === 'completed' ? 2 : null,
    approvalStatus: null,
    activityIntents: []
  };
}

describe('timeline auto-expand', () => {
  it('does not expand exploration or web-search rows', () => {
    expect(isWorkRowExpandable(command('pending'))).toBe(true);
    expect(isWorkRowExpandable({
      ...command('pending'),
      activityIntents: [{ type: 'read', command: 'Read', name: 'Read', path: 'README.md' }]
    })).toBe(false);
    expect(isWorkRowExpandable({
      ...base,
      id: 'w1',
      kind: 'work',
      workKind: 'web-search',
      status: 'completed',
      callId: 'w1',
      queries: ['alpha'],
      completedAt: 2
    })).toBe(false);
  });

  it('auto-opens the live pending frontier while the thread is active', () => {
    const pending = command('pending', 'live');
    const ids = collectTimelineAutoExpansionRowIds({
      rows: [pending],
      scopeActive: true
    });
    expect(ids.liveFrontierRowIds.has('live')).toBe(true);
    expect(collectTimelineAutoExpansionRowIds({
      rows: [pending],
      scopeActive: false
    }).liveFrontierRowIds.size).toBe(0);
  });

  it('auto-opens a pending workflow at the live frontier', () => {
    const row: TimelineViewWorkRow = {
      ...base,
      id: 'wf',
      kind: 'work',
      workKind: 'workflow',
      status: 'pending',
      itemId: 'i',
      taskType: 'local_workflow',
      workflowName: 'Build',
      description: 'Ship',
      model: null,
      taskStatus: 'running',
      workflow: { phases: [{ index: 1, title: 'Go' }], agents: [] },
      usage: null,
      summary: null,
      error: null,
      completedAt: null
    };
    expect(isWorkRowExpandable(row)).toBe(true);
    const ids = collectTimelineAutoExpansionRowIds({ rows: [row], scopeActive: true });
    expect(ids.liveFrontierRowIds.has('wf')).toBe(true);
  });

  it('auto-opens a terminal system error with detail', () => {
    const row: ThreadTimelineViewRow = {
      ...base,
      id: 'sys-err',
      kind: 'system',
      systemKind: 'error',
      title: 'Failed',
      detail: 'boom',
      status: 'error'
    };
    expect(isRowExpandable(row)).toBe(true);
    const ids = collectTimelineAutoExpansionRowIds({ rows: [row], scopeActive: false });
    expect(ids.terminalFrontierRowIds.has('sys-err')).toBe(true);
  });

  it('treats search/fetch-only summaries as non-expandable', () => {
    expect(isNonExpandableSummary([{
      ...base,
      id: 'w1',
      kind: 'work',
      workKind: 'web-search',
      status: 'completed',
      callId: 'w1',
      queries: ['q'],
      completedAt: 2
    }])).toBe(true);
  });

  it('classifies remaining work kinds and nested frontier visits', () => {
    expect(isWorkRowExpandable({
      ...base,
      id: 'img',
      kind: 'work',
      workKind: 'image-view',
      status: 'completed',
      callId: 'img',
      path: 'shot.png',
      completedAt: 2
    })).toBe(true);
    expect(isWorkRowExpandable({
      ...base,
      id: 'q',
      kind: 'work',
      workKind: 'question',
      status: 'pending',
      callId: 'q',
      interactionId: 'pi',
      lifecycle: 'pending',
      questions: [],
      answers: null,
      statusReason: null
    })).toBe(true);
    expect(isWorkRowExpandable({
      ...base,
      id: 'ap',
      kind: 'work',
      workKind: 'approval',
      status: 'pending',
      callId: 'ap',
      interactionId: 'pi',
      approvalKind: 'file-edit',
      lifecycle: 'waiting',
      target: { itemId: 'i', toolName: null }
    })).toBe(false);
    const child = command('pending', 'child');
    const delegation: TimelineViewWorkRow = {
      ...base,
      id: 'del',
      kind: 'work',
      workKind: 'delegation',
      status: 'pending',
      callId: 'del',
      toolName: 'spawnAgent',
      subagentType: 'explore',
      description: 'Look around',
      childRows: [child],
      output: '',
      completedAt: null
    };
    expect(isWorkRowExpandable(delegation)).toBe(true);
    expect(isRowExpandable({
      ...base,
      id: 'conv',
      kind: 'conversation',
      role: 'user',
      text: 'hi',
      attachments: null,
      initiator: 'user',
      senderThreadId: null,
      systemMessageKind: 'unlabeled',
      systemMessageSubject: null,
      turnRequest: { isGrouped: false, kind: 'message', status: 'accepted' },
      mentions: []
    })).toBe(false);
    expect(isRowExpandable({
      ...base,
      id: 'turn',
      kind: 'turn',
      children: [command('completed')]
    })).toBe(true);
    const live = collectTimelineAutoExpansionRowIds({
      rows: [delegation],
      scopeActive: true
    });
    expect(live.liveFrontierRowIds.has('del')).toBe(true);
    expect(live.liveFrontierRowIds.has('child')).toBe(true);
    const systemPending: ThreadTimelineViewRow = {
      ...base,
      id: 'sys-p',
      kind: 'system',
      systemKind: 'operation',
      title: 'Provisioning',
      detail: 'starting',
      status: 'pending'
    };
    expect(collectTimelineAutoExpansionRowIds({
      rows: [systemPending],
      scopeActive: true
    }).liveFrontierRowIds.has('sys-p')).toBe(true);
  });
});
