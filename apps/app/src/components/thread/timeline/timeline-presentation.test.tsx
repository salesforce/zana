import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkRowBody } from './WorkRowBody.js';
import { ThreadContextChip, ThreadGoalBanner, ThreadWorkingIndicator } from './ThreadBanners.js';
import { ConversationRow } from './ConversationRow.js';
import { TimelineTitleView, stopTitleEvent } from './TimelineTitleView.js';
import { mentionPillLabel } from './mention-pills.js';
import { imagePreviewSrc, resolveQuestionAnswer } from './work-row-helpers.js';
import { decorationText, isPastWorkRow, titleSegmentClass } from './timeline-title.js';
import { firstUnreadRowId, isNearBottom, shouldStickToBottom } from './timeline-scroll.js';

const workBase = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1,
  kind: 'work' as const,
  callId: 'c1'
};

describe('timeline title helpers', () => {
  it('formats decorations and CSS classes', () => {
    expect(decorationText({ kind: 'diff-stats', added: 1, removed: 0 }, 0)).toBe('+1 −0');
    expect(decorationText({ kind: 'status', status: 'error' }, 0)).toBe('error');
    expect(decorationText({
      kind: 'summary-status',
      errorCount: 1,
      interruptedCount: 2
    }, 0)).toBe('1 error, 2 interrupted');
    expect(decorationText({ kind: 'duration', startedAt: 0, completedAt: 1000, em: false }, 0)).toEqual(expect.any(String));
    expect(titleSegmentClass({ em: true, accent: 'file', truncate: true, shimmer: true }))
      .toBe('is-em is-shimmer is-truncate accent-file');
    expect(isPastWorkRow({ kind: 'work', status: 'completed' })).toBe(true);
    expect(isPastWorkRow({ kind: 'system', status: 'error' })).toBe(true);
    expect(isPastWorkRow({ kind: 'conversation' })).toBe(false);
  });
});

describe('WorkRowBody', () => {
  it('renders command output as a terminal block', () => {
    const html = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'c1',
        workKind: 'command',
        status: 'pending',
        command: 'ls -la',
        cwd: null,
        source: 'user',
        output: 'README.md',
        exitCode: null,
        completedAt: null,
        approvalStatus: null,
        activityIntents: []
      }} />
    );
    expect(html).toContain('$ ls -la');
    expect(html).toContain('README.md');
    expect(html).toContain('source: user');
  });

  it('renders file-change hunks and stats', () => {
    const html = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'fc1',
        workKind: 'file-change',
        status: 'completed',
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
      }} />
    );
    expect(html).toContain('README.md');
    expect(html).toContain('+1');
    expect(html).toContain('@@');
  });

  it('renders workflow progress and image stubs', () => {
    const workflow = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'wf1',
        workKind: 'workflow',
        status: 'pending',
        itemId: 'item-1',
        taskType: 'local_workflow',
        workflowName: 'Build',
        description: 'Ship it',
        model: null,
        taskStatus: 'running',
        workflow: {
          phases: [{ index: 1, title: 'Explore' }],
          agents: [{
            index: 1,
            label: 'Coder',
            state: 'running',
            model: 'default',
            attempt: 1,
            cached: false,
            lastProgressAt: 1
          }]
        },
        usage: null,
        summary: null,
        error: null,
        completedAt: null
      }} />
    );
    expect(workflow).toContain('Explore');
    expect(workflow).toContain('Coder');
    const image = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'img1',
        workKind: 'image-view',
        status: 'completed',
        path: 'shot.png',
        completedAt: 2
      }} />
    );
    expect(image).toContain('shot.png');
    expect(image).toContain('thread-image-stub');
  });

  it('renders pending questions and waiting approvals', () => {
    const question = renderToStaticMarkup(
      <WorkRowBody
        onAnswer={() => undefined}
        row={{
          ...workBase,
          id: 'q1',
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
        }}
      />
    );
    expect(question).toContain('Continue?');
    expect(question).toContain('thread-question-input');
    const approval = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'a1',
        workKind: 'approval',
        status: 'pending',
        interactionId: 'pi_2',
        approvalKind: 'file-edit',
        lifecycle: 'waiting',
        target: { itemId: 'item', toolName: 'Edit' }
      }} />
    );
    expect(approval).toContain('Waiting for approval');
    expect(approval).toContain('thread-approval-row');
  });

  it('renders tool args and denied approvals without a fake approve control', () => {
    const tool = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'tool-1',
        workKind: 'tool',
        status: 'completed',
        toolName: 'Read',
        toolArgs: { path: 'README.md' },
        output: 'ok',
        completedAt: 2,
        approvalStatus: null,
        activityIntents: []
      }} />
    );
    expect(tool).toContain('Read');
    expect(tool).toContain('README.md');
    const denied = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'a2',
        workKind: 'approval',
        status: 'completed',
        interactionId: 'pi_3',
        approvalKind: 'file-edit',
        lifecycle: 'denied',
        target: { itemId: 'item', toolName: null }
      }} />
    );
    expect(denied).toContain('Denied');
    expect(denied).not.toContain('Approve');
  });

  it('renders file-change stderr, workflow errors, and title-only web rows', () => {
    const file = renderToStaticMarkup(
      <WorkRowBody
        onOpenDiff={() => undefined}
        row={{
          ...workBase,
          id: 'fc2',
          workKind: 'file-change',
          status: 'completed',
          change: {
            path: 'a.ts',
            kind: 'update',
            movePath: null,
            diff: null,
            diffStats: { added: 0, removed: 1 }
          },
          stdout: null,
          stderr: 'conflict',
          approvalStatus: null
        }}
      />
    );
    expect(file).toContain('a.ts');
    expect(file).toContain('conflict');
    expect(file).toContain('thread-file-change-path');
    const workflow = renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'wf2',
        workKind: 'workflow',
        status: 'completed',
        itemId: 'item-2',
        taskType: 'local_workflow',
        workflowName: null,
        description: '',
        model: null,
        taskStatus: 'failed',
        workflow: null,
        usage: null,
        summary: 'failed run',
        error: 'boom',
        completedAt: 3
      }} />
    );
    expect(workflow).toContain('failed run');
    expect(workflow).toContain('boom');
    expect(renderToStaticMarkup(
      <WorkRowBody row={{
        ...workBase,
        id: 'ws',
        workKind: 'web-search',
        status: 'completed',
        queries: ['q'],
        completedAt: 2
      }} />
    )).toBe('');
  });
});

describe('conversation and banners', () => {
  it('renders mention pills and copy chrome', () => {
    const html = renderToStaticMarkup(
      <ConversationRow
        onCopy={() => undefined}
        row={{
          ...workBase,
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
          mentions: [{
            start: 5,
            end: 14,
            resource: { kind: 'path', source: 'workspace', entryKind: 'file', path: 'README.md', label: 'README.md' }
          }]
        }}
      />
    );
    expect(html).toContain('README.md');
    expect(html).toContain('thread-copy-message');
    expect(html).toContain('thread-timeline-row is-user');
    expect(html).toContain('thread-timeline-bubble');
  });

  it('labels mentions from resource fields', () => {
    expect(mentionPillLabel({ resource: { kind: 'path', label: 'src' } })).toBe('src');
    expect(mentionPillLabel({ resource: { kind: 'path', path: 'a.ts' } })).toBe('a.ts');
    expect(mentionPillLabel({ resource: { kind: 'command', name: 'help' } })).toBe('help');
    expect(mentionPillLabel({})).toBe('');
  });

  it('builds image data URLs and question answers', () => {
    expect(imagePreviewSrc({ contentType: 'image/svg+xml', content: '<svg />' })).toContain('data:image/svg+xml');
    expect(imagePreviewSrc({ contentType: 'image/png', content: 'x' })).toBeNull();
    expect(resolveQuestionAnswer(' yes ', ['Continue?'])).toBe('yes');
    expect(resolveQuestionAnswer('  ', ['Continue?'])).toBe('Continue?');
  });

  it('shows thinking, goal, and context chips', () => {
    expect(renderToStaticMarkup(
      <ThreadWorkingIndicator status="active" thinking={{ id: 'th', text: 'Planning', startedAt: 1, updatedAt: 1 }} />
    )).toContain('Planning');
    expect(renderToStaticMarkup(
      <ThreadGoalBanner goal={{
        sourceSeq: 1,
        updatedAt: 1,
        objective: 'Ship the UI',
        status: 'active',
        tokenBudget: null,
        tokensUsed: 0,
        timeUsedSeconds: 0
      }} />
    )).toContain('Ship the UI');
    expect(renderToStaticMarkup(
      <ThreadContextChip usage={{ usedTokens: 50, modelContextWindow: 100, estimated: true }} />
    )).toContain('~50% context');
  });
});

describe('title view and scroll helpers', () => {
  it('renders file accents and duration decorations', () => {
    const html = renderToStaticMarkup(
      <TimelineTitleView
        now={2000}
        title={{
          segments: [{ text: 'Edited ', em: false, shimmer: false, truncate: false }, {
            text: 'README.md',
            em: true,
            shimmer: false,
            truncate: true,
            accent: 'file'
          }],
          decorations: [{ kind: 'diff-stats', added: 1, removed: 0 }],
          tone: 'default',
          action: { kind: 'open-file-diff', path: 'README.md' },
          plain: 'Edited README.md'
        }}
        onAction={() => undefined}
      />
    );
    expect(html).toContain('accent-file');
    expect(html).toContain('README.md');
    expect(html).toContain('+1 −0');
    const linked = renderToStaticMarkup(
      <TimelineTitleView
        now={0}
        title={{
          segments: [{
            text: 'parent',
            em: false,
            shimmer: false,
            truncate: false,
            link: { kind: 'thread', threadId: 't2' }
          }],
          decorations: [],
          tone: 'default',
          action: null,
          plain: 'parent'
        }}
        onLink={() => undefined}
      />
    );
    expect(linked).toContain('thread-timeline-title-link');
  });

  it('detects sticky-bottom and unread boundaries', () => {
    expect(isNearBottom({ scrollTop: 100, scrollHeight: 140, clientHeight: 40 })).toBe(true);
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 400, clientHeight: 40 })).toBe(false);
    expect(shouldStickToBottom({ isBusy: true, userPinnedAway: false })).toBe(true);
    expect(shouldStickToBottom({ isBusy: true, userPinnedAway: true })).toBe(false);
    expect(firstUnreadRowId([{ id: 'a', sourceSeqStart: 1 }, { id: 'b', sourceSeqStart: 5 }], 3)).toBe('b');
    expect(firstUnreadRowId([{ id: 'a', sourceSeqStart: 1 }], 0)).toBeNull();
    const prevented = { preventDefault() { this.ok = true; }, stopPropagation() { this.stopped = true; }, ok: false, stopped: false };
    stopTitleEvent(prevented);
    expect(prevented.ok).toBe(true);
    expect(prevented.stopped).toBe(true);
  });
});
