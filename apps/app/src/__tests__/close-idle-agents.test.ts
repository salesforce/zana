import { describe, expect, it, vi } from 'vitest';
import {
  closeFollowupProgressMessage,
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
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 1, 1);
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
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 0, 0);
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
