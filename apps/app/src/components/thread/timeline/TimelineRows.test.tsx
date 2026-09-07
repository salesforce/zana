import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { ThreadTimeline } from '../ThreadTimeline.js';
import { TimelineRows } from './TimelineRows.js';
import type { ThreadTimelineViewRow } from '@zana-ai/zcc-thread-view';

const base = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1
};

function userRow(id: string, text: string, status: 'accepted' | 'pending' = 'accepted'): TimelineRow {
  return {
    ...base,
    id,
    kind: 'conversation',
    role: 'user',
    text,
    attachments: null,
    initiator: 'user',
    senderThreadId: null,
    systemMessageKind: 'unlabeled',
    systemMessageSubject: null,
    turnRequest: { isGrouped: false, kind: 'message', status },
    mentions: []
  };
}

function assistantRow(id: string, text: string): TimelineRow {
  return {
    ...base,
    id,
    kind: 'conversation',
    role: 'assistant',
    text,
    attachments: null,
    turnRequest: null
  };
}

describe('TimelineRows system errors', () => {
  it('keeps a short error title on the row and the detail expandable', () => {
    const row: TimelineRow = {
      id: 'sys-err',
      threadId: 't1',
      turnId: 'turn-1',
      sourceSeqStart: 1,
      sourceSeqEnd: 1,
      startedAt: 1,
      createdAt: 1,
      kind: 'system',
      systemKind: 'error',
      title: 'Provider rate limit reached',
      detail: 'retry in 20s',
      status: 'error'
    };
    const html = renderToStaticMarkup(
      <ThreadTimeline rows={[row]} status="error" thinking={null} />
    );
    expect(html).toContain('thread-timeline-system-title');
    expect(html).toContain('Provider rate limit reached');
    expect(html).toContain('thread-timeline-system-detail');
    expect(html).toContain('retry in 20s');
    expect(html).not.toContain('Provider rate limit reached — retry in 20s');
  });
});

describe('TimelineRows current-turn sticky wrap', () => {
  it('wraps each user prompt with the rows until the next user prompt', () => {
    const html = renderToStaticMarkup(
      <ThreadTimeline
        rows={[
          userRow('u1', 'First ask'),
          assistantRow('a1', 'First reply'),
          userRow('u2', 'Latest ask'),
          assistantRow('a2', 'Latest reply')
        ]}
        status="idle"
        thinking={null}
      />
    );
    const firstWrap = html.indexOf('thread-timeline-current-turn');
    const secondWrap = html.indexOf('thread-timeline-current-turn', firstWrap + 1);
    expect(firstWrap).toBeGreaterThan(-1);
    expect(secondWrap).toBeGreaterThan(firstWrap);
    const firstTurn = html.slice(firstWrap, secondWrap);
    const secondTurn = html.slice(secondWrap);
    expect(firstTurn).toContain('First ask');
    expect(firstTurn).toContain('First reply');
    expect(firstTurn).not.toContain('Latest ask');
    expect(secondTurn).toContain('Latest ask');
    expect(secondTurn).toContain('Latest reply');
    expect(secondTurn).not.toContain('First ask');
  });

  it('wraps nested archived user prompts the same way', () => {
    const html = renderToStaticMarkup(
      <TimelineRows
        rows={[userRow('u1', 'Nested ask') as ThreadTimelineViewRow]}
        now={0}
        expansion={{ liveFrontierRowIds: new Set(), terminalFrontierRowIds: new Set() }}
        nested
      />
    );
    expect(html).toContain('thread-timeline-nested');
    expect(html).toContain('thread-timeline-current-turn');
    expect(html).toContain('Nested ask');
  });
});

describe('TimelineRows plan-execution card', () => {
  const plan = {
    title: 'Force host daemon',
    tasks: [
      { id: '1', text: 'Block Send on unbound remotes', status: 'in_progress' },
      { id: '2', text: 'Reject SSH thread create', status: 'pending' }
    ]
  };

  it('sticks named plan tasks to the latest user message only', () => {
    const html = renderToStaticMarkup(
      <ThreadTimeline
        rows={[
          userRow('u1', 'First ask'),
          assistantRow('a1', 'First reply'),
          userRow('u2', 'Latest ask'),
          assistantRow('a2', 'Latest reply')
        ]}
        status="idle"
        thinking={null}
        planExecution={plan}
      />
    );
    expect(html.split('data-testid="thread-plan-execution"').length - 1).toBe(1);
    const firstWrap = html.indexOf('thread-timeline-current-turn');
    const secondWrap = html.indexOf('thread-timeline-current-turn', firstWrap + 1);
    const firstTurn = html.slice(firstWrap, secondWrap);
    const secondTurn = html.slice(secondWrap);
    expect(firstTurn).not.toContain('thread-plan-execution');
    expect(secondTurn).toContain('Latest ask');
    expect(secondTurn).toContain('thread-plan-execution');
    expect(secondTurn).toContain('1/2');
    expect(secondTurn).toContain('Force host daemon');
  });

  it('does not render a plan card from conversation text alone', () => {
    const html = renderToStaticMarkup(
      <ThreadTimeline
        rows={[userRow('u1', 'Write some todos')]}
        status="idle"
        thinking={null}
      />
    );
    expect(html).toContain('Write some todos');
    expect(html).not.toContain('thread-plan-execution');
  });
});
