import { describe, expect, it, vi } from 'vitest';
import { selectCloseableIdleIds, runCloseIdleAgents } from '../lib/close-idle-agents.js';
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

describe('runCloseIdleAgents', () => {
  function deps(over: Partial<Parameters<typeof runCloseIdleAgents>[0]['deps']> = {}) {
    return {
      statusById: {} as Record<string, AgentState>,
      closeFollowup: vi.fn(async () => ({ summarized: 1, followedUp: 1 })),
      closeTerminal: vi.fn(async () => {}),
      pushBusyToast: vi.fn(),
      pushErrorToast: vi.fn(),
      pushClosedToast: vi.fn(),
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
  });

  it('files follow-up then closes a blocked session when forced', async () => {
    const order: string[] = [];
    const d = deps({
      statusById: { s1: 'blocked' },
      closeFollowup: vi.fn(async () => {
        order.push('followup');
        return { summarized: 1, followedUp: 1 };
      }),
      closeTerminal: vi.fn(async () => {
        order.push('close');
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
    expect(order).toEqual(['followup', 'close']);
    expect(d.closeFollowup).toHaveBeenCalledWith('p1', ['s1']);
    expect(d.closeTerminal).toHaveBeenCalledWith('s1', 'p1');
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 1, 1);
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

  it('still closes after a paper-trail failure', async () => {
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
});
