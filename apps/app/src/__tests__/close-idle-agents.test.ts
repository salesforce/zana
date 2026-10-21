import { describe, expect, it, vi } from 'vitest';
import {
  closeFollowupProgressMessage,
  closedToastMessage,
  selectCloseableIdleIds,
  runCloseIdleAgents
} from '../lib/close-idle-agents.js';
import type { AgentState } from '@zana-ai/zcc-domain/product';

describe('selectCloseableIdleIds', () => {
  const status: Record<string, AgentState> = {
    blocked: 'blocked',
    working: 'working',
    idle: 'idle',
    unknown: 'unknown'
  };

  it('skips working and blocked when force is off', () => {
    expect(selectCloseableIdleIds(['blocked', 'working', 'idle'], status, false)).toEqual(['idle']);
  });

  it('keeps working and blocked when force is on', () => {
    expect(selectCloseableIdleIds(['blocked', 'working', 'idle'], status, true)).toEqual([
      'blocked',
      'working',
      'idle'
    ]);
  });

  it('treats a missing status as still eligible', () => {
    expect(selectCloseableIdleIds(['ghost'], {}, false)).toEqual(['ghost']);
  });
});

describe('closeFollowupProgressMessage', () => {
  it('names a single agent and a bulk close', () => {
    expect(closeFollowupProgressMessage(1)).toBe('Closing… filing a follow-up if work is left.');
    expect(closeFollowupProgressMessage(3)).toBe('Closing 3 agents… filing follow-ups.');
  });
});

describe('runCloseIdleAgents', () => {
  function deps(over: Partial<Parameters<typeof runCloseIdleAgents>[0]['deps']> = {}) {
    return {
      statusById: {} as Record<string, AgentState>,
      alreadyClosingIds: new Set<string>(),
      markClosing: vi.fn(),
      clearClosing: vi.fn(),
      closeFollowup: vi.fn(async () => ({ summarized: 1, followedUp: 1 })),
      closeTerminal: vi.fn(async () => {}),
      pushBusyToast: vi.fn(),
      pushErrorToast: vi.fn(),
      pushClosedToast: vi.fn(),
      pushProgressToast: vi.fn(() => 'progress-toast'),
      dismissProgressToast: vi.fn(),
      ...over
    };
  }

  it('toasts busy-again and does not close when unforced ids are all working or blocked', async () => {
    const d = deps({ statusById: { s1: 'blocked' } });
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: true,
      force: false,
      deps: d
    });
    expect(res).toEqual({ closed: 0, summarized: 0, followedUp: 0 });
    expect(d.pushBusyToast).toHaveBeenCalledWith(1);
    expect(d.closeFollowup).not.toHaveBeenCalled();
    expect(d.closeTerminal).not.toHaveBeenCalled();
    expect(d.markClosing).not.toHaveBeenCalled();
    expect(d.pushProgressToast).not.toHaveBeenCalled();
  });

  it('files follow-up then closes a blocked session when forced', async () => {
    const order: string[] = [];
    const d = deps({
      statusById: { s1: 'blocked' },
      markClosing: vi.fn(() => {
        order.push('mark');
      }),
      pushProgressToast: vi.fn(() => {
        order.push('progress');
        return 'progress-toast';
      }),
      closeFollowup: vi.fn(async () => {
        order.push('followup');
        return { summarized: 1, followedUp: 1 };
      }),
      dismissProgressToast: vi.fn(() => {
        order.push('dismiss');
      }),
      closeTerminal: vi.fn(async () => {
        order.push('close');
      }),
      clearClosing: vi.fn(() => {
        order.push('clear');
      }),
      pushClosedToast: vi.fn(() => {
        order.push('closed');
      })
    });
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: true,
      force: true,
      deps: d
    });
    expect(res).toEqual({ closed: 1, summarized: 1, followedUp: 1 });
    expect(order).toEqual(['mark', 'progress', 'followup', 'close', 'dismiss', 'closed', 'clear']);
    expect(d.closeFollowup).toHaveBeenCalledWith('p1', ['s1']);
    expect(d.closeTerminal).toHaveBeenCalledWith('s1', 'p1');
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 1, 1, undefined);
    expect(d.pushProgressToast).toHaveBeenCalledWith(1);
    expect(d.dismissProgressToast).toHaveBeenCalledWith('progress-toast');
    expect(d.markClosing).toHaveBeenCalledWith(['s1']);
    expect(d.clearClosing).toHaveBeenCalledWith(['s1']);
  });

  it('files follow-up then closes an idle session when forced', async () => {
    const d = deps({ statusById: { s1: 'idle' } });
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: true,
      force: true,
      deps: d
    });
    expect(res.closed).toBe(1);
    expect(d.closeFollowup).toHaveBeenCalled();
    expect(d.closeTerminal).toHaveBeenCalled();
  });

  it('still closes after a paper-trail failure and dismisses the progress toast', async () => {
    const d = deps({
      statusById: { s1: 'idle' },
      closeFollowup: vi.fn(async () => {
        throw new Error('summarize failed');
      })
    });
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: true,
      force: false,
      deps: d
    });
    expect(res.closed).toBe(1);
    expect(d.pushErrorToast).toHaveBeenCalled();
    expect(d.closeTerminal).toHaveBeenCalledWith('s1', 'p1');
    expect(d.pushProgressToast).toHaveBeenCalledWith(1);
    expect(d.dismissProgressToast).toHaveBeenCalledWith('progress-toast');
    expect(d.clearClosing).toHaveBeenCalledWith(['s1']);
  });

  it('reports zero paper-trail counts after closing a session with no readable transcript', async () => {
    const d = deps({
      closeFollowup: vi.fn(async () => ({ summarized: 0, followedUp: 0 }))
    });
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: true,
      force: true,
      deps: d
    });

    expect(res).toEqual({ closed: 1, summarized: 0, followedUp: 0 });
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 0, 0, undefined);
  });

  it('skips the progress toast when summarize is off', async () => {
    const d = deps();
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: false,
      force: true,
      deps: d
    });
    expect(res.closed).toBe(1);
    expect(d.closeFollowup).not.toHaveBeenCalled();
    expect(d.pushProgressToast).not.toHaveBeenCalled();
    expect(d.dismissProgressToast).not.toHaveBeenCalled();
    expect(d.markClosing).toHaveBeenCalledWith(['s1']);
    expect(d.clearClosing).toHaveBeenCalledWith(['s1']);
  });

  it('no-ops ids already marked in flight without a busy toast', async () => {
    const d = deps({ alreadyClosingIds: new Set(['s1']) });
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: true,
      force: true,
      deps: d
    });
    expect(res).toEqual({ closed: 0, summarized: 0, followedUp: 0 });
    expect(d.pushBusyToast).not.toHaveBeenCalled();
    expect(d.markClosing).not.toHaveBeenCalled();
    expect(d.closeFollowup).not.toHaveBeenCalled();
    expect(d.closeTerminal).not.toHaveBeenCalled();
  });

  it('clears in-flight ids even when closeTerminal throws', async () => {
    const d = deps({
      closeTerminal: vi.fn(async () => {
        throw new Error('close failed');
      })
    });
    const res = await runCloseIdleAgents({
      projectId: 'p1',
      sessionIds: ['s1'],
      summarize: true,
      force: true,
      deps: d
    });
    expect(res.closed).toBe(0);
    expect(d.dismissProgressToast).toHaveBeenCalledWith('progress-toast');
    expect(d.clearClosing).toHaveBeenCalledWith(['s1']);
  });
});

describe('closedToastMessage', () => {
  it('keeps the generic hint when failures are absent or empty', () => {
    expect(closedToastMessage(1, 0, 0)).toBe('Closed 1 agent · no readable transcript found.');
    expect(closedToastMessage(2, 0, 0, [{ reason: 'empty' }])).toBe('Closed 2 agents · no readable transcript found.');
  });

  it('names a summary failure, with or without detail', () => {
    expect(closedToastMessage(1, 0, 0, [{ reason: 'summary-failed', detail: 'spawn EACCES' }])).toBe('Closed 1 agent · the AI summary failed (details in the log).');
    expect(closedToastMessage(1, 0, 0, [{ reason: 'summary-failed' }])).toBe('Closed 1 agent · the AI summary failed (details in the log).');
  });

  it('names unparseable and write failures', () => {
    expect(closedToastMessage(1, 0, 0, [{ reason: 'unparseable' }])).toBe('Closed 1 agent · the AI reply could not be understood.');
    expect(closedToastMessage(1, 0, 0, [{ reason: 'write-failed' }])).toBe('Closed 1 agent · could not save the summary or follow-up.');
  });

  it('never shows the raw error detail in the toast', () => {
    expect(closedToastMessage(1, 0, 0, [{ reason: 'summary-failed', detail: 'spawn EACCES' }])).not.toContain('EACCES');
  });

  it('says the follow-up could not be filed when its write failed after a summary', () => {
    expect(closedToastMessage(1, 1, 0, [{ reason: 'write-failed', detail: 'disk' }])).toBe('Closed 1 agent · 1 summarized to inbox · could not file the follow-up.');
    // Inbox write failed but the follow-up was filed: the lost summary is mentioned.
    expect(closedToastMessage(1, 0, 1, [{ reason: 'write-failed' }])).toBe('Closed 1 agent · 1 follow-up filed · could not save the summary.');
    expect(closedToastMessage(1, 0, 1)).toBe('Closed 1 agent · 1 follow-up filed.');
    expect(closedToastMessage(1, 1, 1, [{ reason: 'write-failed' }])).toBe('Closed 1 agent · 1 summarized to inbox · 1 follow-up filed.');
    expect(closedToastMessage(1, 1, 0, [])).toBe('Closed 1 agent · 1 summarized to inbox · no unfinished work found.');
  });


  it('ignores unrelated failures when something was summarized or filed', () => {
    expect(closedToastMessage(1, 1, 0, [{ reason: 'empty' }])).toBe('Closed 1 agent · 1 summarized to inbox · no unfinished work found.');
    expect(closedToastMessage(1, 1, 2, [{ reason: 'empty' }])).toBe('Closed 1 agent · 1 summarized to inbox · 2 follow-ups filed.');
  });
});

describe('runCloseIdleAgents failures', () => {
  it('passes failures from closeFollowup to the closed toast', async () => {
    const failures = [{ reason: 'summary-failed' as const, detail: 'x' }];
    const pushClosedToast = vi.fn();
    await runCloseIdleAgents({
      projectId: 'p', sessionIds: ['s1'], summarize: true, force: false,
      deps: {
        statusById: {}, alreadyClosingIds: new Set(), markClosing: vi.fn(), clearClosing: vi.fn(),
        closeFollowup: vi.fn(async () => ({ summarized: 0, followedUp: 0, failures })),
        closeTerminal: vi.fn(async () => {}), pushBusyToast: vi.fn(), pushErrorToast: vi.fn(), pushClosedToast,
        pushProgressToast: vi.fn(() => 't'), dismissProgressToast: vi.fn()
      }
    });
    expect(pushClosedToast).toHaveBeenCalledWith(1, 0, 0, failures);
  });
});
