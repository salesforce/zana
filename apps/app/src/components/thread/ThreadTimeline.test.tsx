import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import { ThreadTimeline } from './ThreadTimeline.js';
import {
  isBusyThreadStatus,
  shouldShowThreadStop,
  threadStatusLabel,
  threadStatusToAgentState,
  threadStatusTone,
  timelineHasInFlightRetry,
  timelineRowsAwaitUser,
  visiblePendingTodos,
  workRowBody
} from './thread-timeline-model.js';

const base = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1
};

describe('thread timeline model', () => {
  it('treats starting/active/stopping as busy', () => {
    expect(isBusyThreadStatus('active')).toBe(true);
    expect(isBusyThreadStatus('idle')).toBe(false);
  });

  it('shows Stop only while a thread round is in flight', () => {
    expect(shouldShowThreadStop('t1', 'active')).toBe(true);
    expect(shouldShowThreadStop('t1', 'starting')).toBe(true);
    expect(shouldShowThreadStop('t1', 'stopping')).toBe(true);
    expect(shouldShowThreadStop('t1', 'idle')).toBe(false);
    expect(shouldShowThreadStop('t1', 'error')).toBe(false);
    expect(shouldShowThreadStop(undefined, 'active')).toBe(false);
    expect(shouldShowThreadStop('t1', 'error', true)).toBe(true);
    expect(shouldShowThreadStop('t1', 'idle', true)).toBe(false);
    expect(shouldShowThreadStop(undefined, 'error', true)).toBe(false);
  });

  it('treats a trailing reconnect row as an in-flight retry', () => {
    const reconnect: TimelineRow = {
      ...base,
      id: 'retry-1',
      kind: 'system',
      systemKind: 'reconnect',
      title: 'Provider authorization failed',
      detail: 'Claude Code API retry 5/10 after 9168ms: HTTP 401 authentication_failed',
      status: null
    };
    expect(timelineHasInFlightRetry([reconnect])).toBe(true);
    expect(timelineHasInFlightRetry([{
      ...base,
      id: 'turn-1',
      kind: 'turn',
      turnId: 'turn-1',
      status: 'pending',
      summaryCount: 1,
      completedAt: null,
      children: [reconnect]
    }])).toBe(true);
    expect(timelineHasInFlightRetry([{
      ...base,
      id: 'err-retry',
      kind: 'system',
      systemKind: 'error',
      title: 'Provider authorization failed',
      detail: 'Claude Code API retry 5/10 after 9168ms: HTTP 401 authentication_failed',
      status: 'error'
    }])).toBe(true);
    expect(timelineHasInFlightRetry([{
      ...base,
      id: 'err-1',
      kind: 'system',
      systemKind: 'error',
      title: 'Provider authorization failed',
      detail: 'HTTP 401 authentication_failed',
      status: 'error'
    }])).toBe(false);
    expect(timelineHasInFlightRetry([{
      ...base,
      id: 'turn-done',
      kind: 'turn',
      turnId: 'turn-1',
      status: 'completed',
      summaryCount: 2,
      completedAt: 2,
      children: [
        reconnect,
        {
          ...base,
          id: 'a1',
          kind: 'conversation',
          role: 'assistant',
          text: 'Done.',
          attachments: null,
          turnRequest: null
        }
      ]
    }])).toBe(false);
  });

  it('maps conversation status onto agent lanes', () => {
    expect(threadStatusToAgentState('starting')).toBe('working');
    expect(threadStatusToAgentState('active')).toBe('working');
    expect(threadStatusToAgentState('stopping')).toBe('working');
    expect(threadStatusToAgentState('idle')).toBe('idle');
    expect(threadStatusToAgentState('error')).toBe('idle');
    expect(threadStatusToAgentState('error', true)).toBe('idle');
    expect(threadStatusToAgentState('active', true)).toBe('blocked');
  });

  it('keeps an error tone distinct from Needs you', () => {
    expect(threadStatusTone('error')).toBe('error');
    expect(threadStatusTone('error', true)).toBe('error');
    expect(threadStatusTone('active', true)).toBe('blocked');
    expect(threadStatusTone('idle')).toBe('idle');
  });

  it('titles status badges with a readable label', () => {
    expect(threadStatusLabel('active')).toBe('Working');
    expect(threadStatusLabel('starting')).toBe('Working');
    expect(threadStatusLabel('stopping')).toBe('Working');
    expect(threadStatusLabel('idle')).toBe('Idle');
    expect(threadStatusLabel('error')).toBe('Error');
    expect(threadStatusLabel('error', true)).toBe('Error');
    expect(threadStatusLabel('')).toBe('');
    expect(threadStatusLabel('active', true)).toBe('Needs you');
    expect(threadStatusLabel('active', false, { id: 'th', text: '', startedAt: 1, updatedAt: 1 })).toBe('Thinking');
    expect(threadStatusLabel('starting', false, { id: 'th', text: 'plan', startedAt: 1, updatedAt: 1 })).toBe('Thinking');
    expect(threadStatusLabel('active', true, { id: 'th', text: 'plan', startedAt: 1, updatedAt: 1 })).toBe('Needs you');
    expect(threadStatusLabel('idle', false, { id: 'th', text: 'plan', startedAt: 1, updatedAt: 1 })).toBe('Idle');
  });

  it('treats pending questions and approvals as waiting on the user', () => {
    const question: TimelineRow = {
      ...base,
      id: 'q1',
      kind: 'work',
      workKind: 'question',
      status: 'pending',
      interactionId: 'pi_1',
      lifecycle: 'pending',
      questions: [{
        id: 'q',
        prompt: 'Continue?',
        multiSelect: false,
        allowFreeText: true
      }],
      answers: null,
      statusReason: null
    };
    expect(timelineRowsAwaitUser([question])).toBe(true);
    expect(timelineRowsAwaitUser([{
      ...question,
      id: 'q-done',
      status: 'completed',
      lifecycle: 'answered',
      answers: { q: { selected: ['yes'] } }
    }])).toBe(false);
    expect(timelineRowsAwaitUser([{
      ...base,
      id: 'turn-wrap',
      kind: 'turn',
      turnId: 'turn-1',
      status: 'pending',
      summaryCount: 1,
      completedAt: null,
      children: [question]
    }])).toBe(true);
    expect(timelineRowsAwaitUser([{
      ...base,
      id: 'a1',
      kind: 'work',
      workKind: 'approval',
      status: 'pending',
      interactionId: 'pi_2',
      approvalKind: 'file-edit',
      lifecycle: 'waiting',
      target: { itemId: 'item', toolName: 'Edit' }
    }])).toBe(true);
  });

  it('hides todos when every item is completed', () => {
    expect(visiblePendingTodos({
      sourceSeq: 1,
      updatedAt: 1,
      items: [{ id: '1', text: 'done', status: 'completed' }]
    })).toBeNull();
    expect(visiblePendingTodos({
      sourceSeq: 1,
      updatedAt: 1,
      items: [
        { id: '1', text: 'open', status: 'pending' },
        { id: '2', text: 'done', status: 'completed' }
      ]
    })?.items).toHaveLength(2);
  });

  it('formats command and file-change bodies', () => {
    expect(workRowBody({ workKind: 'command', output: 'hello' })).toBe('hello');
    expect(workRowBody({ workKind: 'tool', output: 'ok' })).toBe('ok');
    expect(workRowBody({
      workKind: 'file-change',
      change: { path: 'README.md', diff: '@@', diffStats: { added: 1, removed: 0 } }
    })).toContain('README.md');
    expect(workRowBody({ workKind: 'web-search', queries: ['alpha', 'beta'] })).toBe('alpha\nbeta');
    expect(workRowBody({ workKind: 'web-fetch', url: 'https://example.com' })).toBe('https://example.com');
    expect(workRowBody({ workKind: 'image-view', path: 'shot.png' })).toBe('shot.png');
    expect(workRowBody({ workKind: 'workflow', summary: 'done' })).toBe('done');
    expect(workRowBody({
      workKind: 'question',
      questions: [{ prompt: 'Continue?' }, 'skip', { other: true }]
    })).toBe('Continue?');
    expect(workRowBody({ workKind: 'unknown' })).toBe('');
  });
});

describe('ThreadTimeline', () => {
  it('renders user and assistant conversation text with markdown', () => {
    const rows: TimelineRow[] = [
      {
        ...base,
        id: 'u1',
        kind: 'conversation',
        role: 'user',
        text: 'Read README.md',
        attachments: null,
        initiator: 'user',
        senderThreadId: null,
        systemMessageKind: 'unlabeled',
        systemMessageSubject: null,
        turnRequest: { isGrouped: false, kind: 'message', status: 'accepted' },
        mentions: []
      },
      {
        ...base,
        id: 'a1',
        kind: 'conversation',
        role: 'assistant',
        text: 'Hello **world**',
        attachments: null,
        turnRequest: null
      }
    ];
    const html = renderToStaticMarkup(
      <ThreadTimeline rows={rows} status="idle" thinking={null} />
    );
    expect(html).toContain('thread-detail-timeline thread-scrollbar');
    expect(html).toContain('data-testid="thread-user-text"');
    expect(html).toContain('thread-timeline-item is-user');
    expect(html).toContain('Read README.md');
    expect(html).toContain('data-testid="thread-assistant-text"');
    expect(html).toContain('thread-timeline-item is-assistant');
    expect(html).toContain('<strong>world</strong>');
  });

  it('renders pending command titles and thinking without todos', () => {
    const rows: TimelineRow[] = [{
      ...base,
      id: 'c1',
      kind: 'work',
      workKind: 'command',
      status: 'pending',
      callId: 'call-1',
      command: 'ls -la',
      cwd: '/tmp',
      source: null,
      output: 'README.md',
      exitCode: null,
      completedAt: null,
      approvalStatus: null,
      activityIntents: []
    }];
    const html = renderToStaticMarkup(
      <ThreadTimeline
        rows={rows}
        status="active"
        thinking={{ id: 'th1', text: 'Thinking…', startedAt: 1, updatedAt: 1 }}
      />
    );
    expect(html).toContain('data-testid="thread-work-row"');
    expect(html).toContain('ls -la');
    expect(html).toContain('README.md');
    expect(html).toContain('data-testid="thread-thinking"');
    expect(html).toContain('Thinking…');
    expect(html).not.toContain('data-testid="thread-todos"');
  });

  it('shows Thinking… for empty thought text and Working… when thinking is absent', () => {
    const empty = renderToStaticMarkup(
      <ThreadTimeline rows={[]} status="active" thinking={{ id: 'th', text: '  ', startedAt: 1, updatedAt: 1 }} />
    );
    expect(empty).toContain('data-testid="thread-thinking"');
    expect(empty).toContain('Thinking…');
    expect(empty).not.toContain('<details');
    const working = renderToStaticMarkup(
      <ThreadTimeline rows={[]} status="active" thinking={null} />
    );
    expect(working).toContain('Working…');
    expect(working).not.toContain('Thinking…');
  });

  it('renders completed command output, file-change stats, and system lines', () => {
    const rows: TimelineRow[] = [
      {
        ...base,
        id: 'c2',
        kind: 'work',
        workKind: 'command',
        status: 'completed',
        callId: 'call-2',
        command: 'ls',
        cwd: null,
        source: null,
        output: 'a.txt',
        exitCode: 0,
        completedAt: 2,
        approvalStatus: null,
        activityIntents: []
      },
      {
        ...base,
        id: 'fc1',
        kind: 'work',
        workKind: 'file-change',
        status: 'completed',
        callId: 'edit-1',
        change: {
          path: 'README.md',
          kind: 'update',
          movePath: null,
          diff: '@@',
          diffStats: { added: 1, removed: 0 }
        },
        stdout: null,
        stderr: null,
        approvalStatus: null
      },
      {
        ...base,
        id: 'sys1',
        kind: 'system',
        systemKind: 'reconnect',
        title: 'Reconnected',
        detail: 'host online',
        status: null
      }
    ];
    const html = renderToStaticMarkup(
      <ThreadTimeline rows={rows} status="idle" thinking={null} />
    );
    expect(html).toContain('a.txt');
    expect(html).toContain('README.md');
    expect(html).toContain('+1 −0');
    expect(html).toContain('data-testid="thread-system-row"');
    expect(html).toContain('Reconnected — host online');
    expect(html).not.toContain('data-testid="thread-todos"');
    expect(html).not.toContain('data-testid="thread-thinking"');
  });

  it('unwraps turn children and shows Working when busy without thinking text', () => {
    const assistant: TimelineRow = {
      ...base,
      id: 'a2',
      kind: 'conversation',
      role: 'assistant',
      text: 'Done.',
      attachments: null,
      turnRequest: null
    };
    const rows: TimelineRow[] = [{
      ...base,
      id: 'turn-wrap',
      kind: 'turn',
      turnId: 'turn-1',
      status: 'completed',
      summaryCount: 1,
      completedAt: 2,
      children: [assistant]
    }];
    const html = renderToStaticMarkup(
      <ThreadTimeline rows={rows} status="starting" thinking={null} />
    );
    expect(html).toContain('data-testid="thread-assistant-text"');
    expect(html).toContain('Done.');
    expect(html).toContain('Working…');
  });

  it('shows expandable Thinking when reasoning text is streaming', () => {
    const html = renderToStaticMarkup(
      <ThreadTimeline
        rows={[]}
        status="active"
        thinking={{ id: 'th', text: 'I should inspect nearby files.', startedAt: 1, updatedAt: 1 }}
      />
    );
    expect(html).toContain('Thinking…');
    expect(html).toContain('I should inspect nearby files.');
    expect(html).toContain('thread-timeline-work-chevron');
    expect(html).not.toContain('Working…');
  });

  it('shows the empty waiting state', () => {
    const html = renderToStaticMarkup(
      <ThreadTimeline rows={[]} status="idle" thinking={null} />
    );
    expect(html).toContain('Waiting for the first turn…');
  });

  it('bundles consecutive commands into a summary row', () => {
    const command = (id: string, command: string): TimelineRow => ({
      ...base,
      id,
      kind: 'work',
      workKind: 'command',
      status: 'pending',
      callId: id,
      command,
      cwd: null,
      source: null,
      output: '',
      exitCode: null,
      completedAt: null,
      approvalStatus: null,
      activityIntents: []
    });
    const html = renderToStaticMarkup(
      <ThreadTimeline
        rows={[command('c-a', 'ls'), command('c-b', 'pwd')]}
        status="active"
        thinking={null}
      />
    );
    expect(html).toContain('data-testid="thread-work-row"');
    expect(html).toContain('Working…');
    expect(renderToStaticMarkup(
      <ThreadTimeline
        rows={[command('c-a', 'ls'), command('c-b', 'pwd')]}
        status="active"
        thinking={null}
        waitingOnUser
      />
    )).not.toContain('Working…');
    expect(renderToStaticMarkup(
      <ThreadTimeline
        rows={[{
          ...base,
          id: 'q1',
          kind: 'work',
          workKind: 'question',
          status: 'pending',
          interactionId: 'pi_1',
          lifecycle: 'pending',
          questions: [{
            id: 'q',
            prompt: 'Continue?',
            multiSelect: false,
            allowFreeText: true
          }],
          answers: null,
          statusReason: null
        }]}
        status="active"
        thinking={null}
      />
    )).not.toContain('Working…');
  });

  it('renders goal, context, unread divider, and load-older', () => {
    const rows: TimelineRow[] = [{
      ...base,
      id: 'u1',
      kind: 'conversation',
      role: 'user',
      text: 'Hello',
      attachments: null,
      initiator: 'user',
      senderThreadId: null,
      systemMessageKind: 'unlabeled',
      systemMessageSubject: null,
      turnRequest: { isGrouped: false, kind: 'message', status: 'accepted' },
      mentions: [],
      sourceSeqStart: 4,
      sourceSeqEnd: 4
    }];
    const html = renderToStaticMarkup(
      <ThreadTimeline
        rows={rows}
        status="idle"
        thinking={null}
        goal={{
          sourceSeq: 1,
          updatedAt: 1,
          objective: 'Ship UI',
          status: 'active',
          tokenBudget: null,
          tokensUsed: 0,
          timeUsedSeconds: 0
        }}
        lastReadSeq={1}
        hasOlderRows
      />
    );
    expect(html).toContain('Ship UI');
    expect(html).toContain('thread-unread-divider');
    expect(html).toContain('thread-load-older');
  });
});
