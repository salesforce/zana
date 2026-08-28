import { describe, expect, it } from 'vitest';
import { buildTimelineViewRows } from '@zana-ai/zcc-thread-view';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { findStreamingAssistantMessageId } from './streaming-assistant.js';

const base = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1
};

function conversation(id: string, role: 'user' | 'assistant', seq: number): TimelineRow {
  if (role === 'user') {
    return {
      ...base,
      id,
      sourceSeqStart: seq,
      sourceSeqEnd: seq,
      kind: 'conversation',
      role: 'user',
      text: 'Hi',
      attachments: null,
      initiator: 'user',
      senderThreadId: null,
      systemMessageKind: 'unlabeled',
      systemMessageSubject: null,
      turnRequest: { isGrouped: false, kind: 'message', status: 'accepted' },
      mentions: []
    };
  }
  return {
    ...base,
    id,
    sourceSeqStart: seq,
    sourceSeqEnd: seq,
    kind: 'conversation',
    role: 'assistant',
    text: 'Working on it',
    attachments: null,
    turnRequest: null
  };
}

describe('findStreamingAssistantMessageId', () => {
  it('returns the trailing top-level assistant message', () => {
    const rows = buildTimelineViewRows([
      conversation('user_1', 'user', 1),
      conversation('assistant_1', 'assistant', 2)
    ]);
    expect(findStreamingAssistantMessageId(rows)).toBe('assistant_1');
  });

  it('returns null when later work follows the assistant message', () => {
    const rows = buildTimelineViewRows([
      conversation('assistant_1', 'assistant', 1),
      {
        ...base,
        id: 'cmd_1',
        sourceSeqStart: 2,
        sourceSeqEnd: 2,
        kind: 'work',
        workKind: 'command',
        status: 'pending',
        callId: 'c1',
        command: 'ls',
        cwd: null,
        source: null,
        output: '',
        exitCode: null,
        completedAt: null,
        approvalStatus: null,
        activityIntents: []
      }
    ]);
    expect(findStreamingAssistantMessageId(rows)).toBeNull();
    expect(findStreamingAssistantMessageId(buildTimelineViewRows([
      conversation('user_1', 'user', 1)
    ]))).toBeNull();
    expect(findStreamingAssistantMessageId([])).toBeNull();
  });

  it('descends into a pending turn that owns the frontier', () => {
    const rows = buildTimelineViewRows([
      {
        ...base,
        id: 'turn_1',
        kind: 'turn',
        turnId: 'turn-1',
        status: 'pending',
        summaryCount: 1,
        completedAt: null,
        children: [
          conversation('user_1', 'user', 1),
          conversation('assistant_nested', 'assistant', 2)
        ]
      }
    ]);
    expect(findStreamingAssistantMessageId(rows)).toBe('assistant_nested');
  });
});
