import { describe, expect, it } from 'vitest';
import type { PendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineRow } from '@zana-ai/zcc-server-contract';
import {
  latestAssistantConversationText,
  pendingPlanApprovalSubject,
  planFileTabTitle,
  resolveThreadPlanDocument
} from './thread-plan-document.js';

const rowBase = {
  threadId: 't1',
  turnId: 'turn-1',
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1
};

function planInteraction(over: { plan?: string; planFilePath?: string | null } = {}): PendingInteraction {
  return {
    id: 'pint_1',
    threadId: 'thr-1',
    turnId: 'turn-1',
    providerId: 'claude-code',
    providerThreadId: 'prov-1',
    providerRequestId: 'req-1',
    origin: {
      kind: 'provider',
      providerId: 'claude-code',
      providerThreadId: 'prov-1',
      providerRequestId: 'req-1'
    },
    status: 'pending',
    payload: {
      kind: 'approval',
      reason: 'Ready to code?',
      availableDecisions: ['allow_once', 'deny'],
      subject: {
        kind: 'plan',
        itemId: 'item-plan',
        plan: over.plan ?? 'Ship it',
        planFilePath: over.planFilePath === undefined ? '/tmp/plan.md' : over.planFilePath
      }
    },
    resolution: null,
    statusReason: null,
    createdAt: 1,
    resolvedAt: null
  };
}

function assistantRow(id: string, text: string): TimelineRow {
  return {
    ...rowBase,
    id,
    kind: 'conversation',
    role: 'assistant',
    text,
    attachments: null,
    turnRequest: null
  };
}

describe('thread plan document', () => {
  it('names a plan file tab from the basename', () => {
    expect(planFileTabTitle('/tmp/plans/ship.md')).toBe('ship.md');
    expect(planFileTabTitle('ship.md')).toBe('ship.md');
  });

  it('reads a pending plan approval and ignores other subjects', () => {
    expect(pendingPlanApprovalSubject([planInteraction()])).toEqual({
      plan: 'Ship it',
      planFilePath: '/tmp/plan.md'
    });
    const command: PendingInteraction = {
      ...planInteraction(),
      payload: {
        kind: 'approval',
        reason: 'Needs approval',
        availableDecisions: ['allow_once'],
        subject: {
          kind: 'command',
          itemId: 'item-1',
          command: 'ls',
          cwd: '/tmp',
          actions: [],
          sessionGrant: null
        }
      }
    };
    expect(pendingPlanApprovalSubject([command])).toBeNull();
  });

  it('walks nested turns for the latest assistant text', () => {
    const rows: TimelineRow[] = [
      assistantRow('a1', 'old draft'),
      {
        ...rowBase,
        id: 'turn-wrap',
        kind: 'turn',
        turnId: 'turn-1',
        status: 'completed',
        summaryCount: 1,
        completedAt: 2,
        children: [assistantRow('a2', '  live plan  ')]
      }
    ];
    expect(latestAssistantConversationText(rows)).toBe('  live plan  ');
    expect(latestAssistantConversationText([])).toBeNull();
  });

  it('returns null when neither plan mode nor a plan approval is present', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'ask', prompt: 'hello' },
      pendingInteractions: [],
      rows: [assistantRow('a1', 'not a plan')]
    })).toBeNull();
  });

  it('keeps an empty plan-mode document so the pin can appear before markdown', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'plan', prompt: ' inspect the failing command ' },
      pendingInteractions: [],
      rows: []
    })).toEqual({
      markdown: null,
      filePath: null,
      prompt: 'inspect the failing command',
      source: 'empty'
    });
  });

  it('prefers the approval markdown over a live assistant draft', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'plan', prompt: 'inspect' },
      pendingInteractions: [planInteraction({ plan: 'Approved body', planFilePath: null })],
      rows: [assistantRow('a1', 'Draft body')]
    })).toEqual({
      markdown: 'Approved body',
      filePath: null,
      prompt: 'inspect',
      source: 'approval'
    });
  });

  it('uses live assistant text while planning before an approval arrives', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'plan' },
      pendingInteractions: [],
      rows: [assistantRow('a1', 'Draft body')]
    })).toEqual({
      markdown: 'Draft body',
      filePath: null,
      prompt: null,
      source: 'live'
    });
  });

  it('shows a pending plan after plan mode has ended', () => {
    expect(resolveThreadPlanDocument({
      promptMode: null,
      pendingInteractions: [planInteraction()],
      rows: [assistantRow('a1', 'stale assistant')]
    })).toEqual({
      markdown: 'Ship it',
      filePath: '/tmp/plan.md',
      prompt: null,
      source: 'approval'
    });
  });
});
