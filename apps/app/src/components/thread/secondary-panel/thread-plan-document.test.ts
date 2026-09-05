import { describe, expect, it } from 'vitest';
import type { ApprovalPendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import {
  pendingPlanApprovalSubject,
  planFileTabTitle,
  resolveThreadPlanDocument
} from './thread-plan-document.js';

function planInteraction(over: { plan?: string; planFilePath?: string | null } = {}): ApprovalPendingInteraction {
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
    const command: ApprovalPendingInteraction = {
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

  it('returns null when neither plan mode nor a plan approval is present', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'ask', prompt: 'hello' },
      pendingInteractions: []
    })).toBeNull();
  });

  it('keeps an empty plan-mode document so the pin can appear before markdown', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'plan', prompt: ' inspect the failing command ' },
      pendingInteractions: []
    })).toEqual({
      markdown: null,
      filePath: null,
      prompt: 'inspect the failing command',
      source: 'empty'
    });
  });

  it('prefers the approval markdown over a durable draft', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'plan', prompt: 'inspect' },
      pendingInteractions: [planInteraction({ plan: 'Approved body', planFilePath: null })],
      durablePlan: { markdown: 'Stale durable' }
    })).toEqual({
      markdown: 'Approved body',
      filePath: null,
      prompt: 'inspect',
      source: 'approval'
    });
  });

  it('does not treat assistant chat as the plan while planning', () => {
    expect(resolveThreadPlanDocument({
      promptMode: { mode: 'plan' },
      pendingInteractions: []
    })).toEqual({
      markdown: null,
      filePath: null,
      prompt: null,
      source: 'empty'
    });
  });

  it('shows a pending plan after plan mode has ended', () => {
    expect(resolveThreadPlanDocument({
      promptMode: null,
      pendingInteractions: [planInteraction()]
    })).toEqual({
      markdown: 'Ship it',
      filePath: '/tmp/plan.md',
      prompt: null,
      source: 'approval'
    });
  });

  it('keeps a durable plan after plan mode ends', () => {
    expect(resolveThreadPlanDocument({
      promptMode: null,
      pendingInteractions: [],
      durablePlan: { markdown: 'Persisted plan', filePath: '/tmp/plans/ship.plan.md' }
    })).toEqual({
      markdown: 'Persisted plan',
      filePath: '/tmp/plans/ship.plan.md',
      prompt: null,
      source: 'durable'
    });
  });

});
