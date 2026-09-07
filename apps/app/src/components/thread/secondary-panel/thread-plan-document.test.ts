import { describe, expect, it } from 'vitest';
import type { ApprovalPendingInteraction } from '@zana-ai/zcc-domain/thread-runtime';
import {
  pendingPlanApprovalSubject,
  planDocumentBadge,
  planDocumentBadgeLabel,
  planFileTabTitle,
  planReferenceDetail,
  planReferenceSummary,
  isLivePlanFilePath,
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

  it('matches a preview path to the live plan file', () => {
    expect(isLivePlanFilePath(
      '/tmp/proj/.zcc/plans/ship.plan.md',
      '/tmp/proj/.zcc/plans/ship.plan.md'
    )).toBe(true);
    expect(isLivePlanFilePath(
      '/private/tmp/proj/.zcc/plans/ship.plan.md',
      'tmp/proj/.zcc/plans/ship.plan.md'
    )).toBe(true);
    expect(isLivePlanFilePath('/tmp/README.md', '/tmp/proj/.zcc/plans/ship.plan.md')).toBe(false);
    expect(isLivePlanFilePath('/tmp/a.plan.md', null)).toBe(false);
    expect(isLivePlanFilePath('/foo/ship.plan.md', '/bar/ship.plan.md')).toBe(false);
  });

  it('derives Building, Ready, and Complete badges', () => {
    expect(planDocumentBadge({
      markdown: '# Plan',
      processing: { text: 'Write tests' },
      tasks: [{ status: 'in_progress' }]
    })).toBe('building');
    expect(planDocumentBadge({
      markdown: '# Plan',
      tasks: [{ status: 'pending' }],
      progress: { completed: 0, total: 1 }
    })).toBe('ready');
    expect(planDocumentBadge({
      status: 'completed',
      markdown: '# Plan',
      tasks: [{ status: 'completed' }],
      progress: { completed: 1, total: 1 }
    })).toBe('complete');
    expect(planDocumentBadge({ status: 'draft', markdown: null, tasks: [] })).toBeNull();
    expect(planDocumentBadgeLabel('building')).toBe('Building');
    expect(planDocumentBadgeLabel('ready')).toBe('Ready');
    expect(planDocumentBadgeLabel('complete')).toBe('Complete');
  });

  it('formats referenced-by copy with title, role, and todo count', () => {
    const refs = [
      { threadId: 't-1', taskId: null, title: 'Pipe prefix in instructions', role: 'Author', todosAssigned: 3 },
      { threadId: 't-1', taskId: 'task-1', title: 'Pipe prefix in instructions', role: 'Author', todosAssigned: 3 }
    ];
    expect(planReferenceSummary(refs)).toBe('Referenced by 1 Agent');
    expect(planReferenceDetail(refs[0]!)).toBe('Pipe prefix in instructions · Author · 3 todos assigned');
    expect(planReferenceDetail({ threadId: 't-2', taskId: null })).toBe('Untitled agent · Agent · 0 todos assigned');
    expect(planReferenceSummary([
      { threadId: 'a', taskId: null },
      { threadId: 'b', taskId: null }
    ])).toBe('Referenced by 2 Agents');
  });
});
