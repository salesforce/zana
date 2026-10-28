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
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 1, 1, undefined, []);
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
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 0, 0, undefined, []);
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
    expect(pushClosedToast).toHaveBeenCalledWith(1, 0, 0, failures, []);
  });
});

describe('Wrap up before closing', () => {
  const baseDeps = (over: Partial<Parameters<typeof runCloseIdleAgents>[0]['deps']> = {}) => ({
    statusById: {} as Record<string, AgentState>,
    alreadyClosingIds: new Set<string>(),
    markClosing: vi.fn(),
    clearClosing: vi.fn(),
    closeFollowup: vi.fn(async (_p: string, _ids: string[]) => ({ summarized: 1, followedUp: 0 }) as Awaited<ReturnType<Parameters<typeof runCloseIdleAgents>[0]['deps']['closeFollowup']>>),
    closeTerminal: vi.fn(async () => {}),
    pushBusyToast: vi.fn(),
    pushErrorToast: vi.fn(),
    pushClosedToast: vi.fn(),
    pushProgressToast: vi.fn(() => 'progress-toast'),
    dismissProgressToast: vi.fn(),
    ...over
  });
  const run = (d: ReturnType<typeof baseDeps>, ids: string[], wrapUp: boolean) =>
    runCloseIdleAgents({ projectId: 'p1', sessionIds: ids, summarize: true, force: true, wrapUp, deps: d });

  it('closes every id except the kept-open ones, with or without wrap-up', async () => {
    const d = baseDeps({ closeFollowup: vi.fn(async () => ({ summarized: 1, followedUp: 0, keptOpen: [{ sessionId: 's2', reason: 'asks-you' as const }] })) });
    const res = await run(d, ['s1', 's2'], false);
    expect(d.closeFollowup).toHaveBeenCalledTimes(1);
    expect(d.closeTerminal).toHaveBeenCalledTimes(1);
    expect(d.closeTerminal).toHaveBeenCalledWith('s1', 'p1');
    expect(res).toEqual({ closed: 1, summarized: 1, followedUp: 0, keptOpen: [{ sessionId: 's2', reason: 'asks-you' }] });
    expect(d.pushClosedToast).toHaveBeenCalledWith(1, 1, 0, undefined, [{ sessionId: 's2', reason: 'asks-you' }]);
  });

  it('closes all when keptOpen is absent', async () => {
    const d = baseDeps();
    expect(await run(d, ['s1', 's2'], false)).toEqual({ closed: 2, summarized: 1, followedUp: 0 });
  });

  it('calls closeFollowup once per id and closes each agent as soon as its own result arrives', async () => {
    const gates: Record<string, (v: { summarized: number; followedUp: number }) => void> = {};
    const d = baseDeps({
      closeFollowup: vi.fn((_p: string, ids: string[]) => new Promise((resolve) => { gates[ids[0]] = resolve as never; })) as never
    });
    const p = run(d, ['slow', 'fast'], true);
    await Promise.resolve();
    expect(d.closeFollowup).toHaveBeenCalledTimes(2);
    expect(d.closeFollowup).toHaveBeenCalledWith('p1', ['slow']);
    expect(d.closeFollowup).toHaveBeenCalledWith('p1', ['fast']);
    expect(d.pushProgressToast).toHaveBeenCalledWith(2);
    gates.fast({ summarized: 1, followedUp: 1 });
    await vi.waitFor(() => expect(d.closeTerminal).toHaveBeenCalledWith('fast', 'p1'));
    expect(d.closeTerminal).not.toHaveBeenCalledWith('slow', 'p1');
    expect(d.dismissProgressToast).not.toHaveBeenCalled();
    gates.slow({ summarized: 1, followedUp: 0 });
    expect(await p).toEqual({ closed: 2, summarized: 2, followedUp: 1 });
    expect(d.dismissProgressToast).toHaveBeenCalledWith('progress-toast');
    expect(d.pushClosedToast).toHaveBeenCalledWith(2, 2, 1, undefined, []);
    expect(d.clearClosing).toHaveBeenCalledWith(['slow', 'fast']);
  });

  it('sends every agent to main at once, so main registers them all at the click', async () => {
    const gates: Record<string, (v: { summarized: number; followedUp: number }) => void> = {};
    const d = baseDeps({
      closeFollowup: vi.fn((_p: string, ids: string[]) => new Promise((resolve) => { gates[ids[0]] = resolve as never; })) as never
    });
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const p = run(d, ids, true);
    await Promise.resolve();
    expect(d.closeFollowup).toHaveBeenCalledTimes(ids.length);
    for (const id of ids) gates[id]({ summarized: 1, followedUp: 0 });
    expect(await p).toEqual({ closed: 6, summarized: 6, followedUp: 0 });
  });

  it('keeps a kept-open agent, sums failures and toasts a failing call once, still closing that agent', async () => {
    const d = baseDeps({
      closeFollowup: vi.fn(async (_p: string, ids: string[]) => {
        if (ids[0] === 'a') return { summarized: 0, followedUp: 0, failures: [{ reason: 'empty' as const }], keptOpen: [{ sessionId: 'a', reason: 'typed' as const }, { sessionId: 'other', reason: 'timeout' as const }] };
        throw new Error('ipc down');
      })
    });
    const res = await run(d, ['a', 'b', 'c'], true);
    expect(d.pushErrorToast).toHaveBeenCalledTimes(1);
    expect(d.closeTerminal.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c']);
    expect(res).toEqual({ closed: 2, summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 'a', reason: 'typed' }] });
    expect(d.pushClosedToast).toHaveBeenCalledWith(2, 0, 0, [{ reason: 'empty' }], [{ sessionId: 'a', reason: 'typed' }]);
  });

  it('toasts kept-open agents even when none was closed, and swallows closeTerminal failures', async () => {
    const d = baseDeps({
      closeFollowup: vi.fn(async (_p: string, ids: string[]) => ({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: ids[0], reason: 'asks-you' as const }] }))
    });
    const res = await run(d, ['s1'], true);
    expect(res.closed).toBe(0);
    expect(d.pushClosedToast).toHaveBeenCalledWith(0, 0, 0, undefined, [{ sessionId: 's1', reason: 'asks-you' }]);
    const failing = baseDeps({ closeTerminal: vi.fn(async () => { throw new Error('x'); }) });
    expect(await run(failing, ['s1'], true)).toEqual({ closed: 0, summarized: 1, followedUp: 0 });
    expect(failing.pushClosedToast).not.toHaveBeenCalled();
  });

  it('makes today\'s single call when wrap-up is off', async () => {
    const d = baseDeps();
    await run(d, ['s1', 's2'], false);
    expect(d.closeFollowup).toHaveBeenCalledTimes(1);
    expect(d.closeFollowup).toHaveBeenCalledWith('p1', ['s1', 's2']);
  });

  it('words the progress toast for wrap-up', () => {
    expect(closeFollowupProgressMessage(1, true)).toBe('Wrapping up… the agent saves what it learnt, then closes.');
    expect(closeFollowupProgressMessage(3, true)).toBe('Wrapping up 3 agents… each closes when it finishes.');
    expect(closeFollowupProgressMessage(1, false)).toBe('Closing… filing a follow-up if work is left.');
  });

  it('words the closed toast with kept-open entries', () => {
    const asks = [{ sessionId: 'a', reason: 'asks-you' as const }];
    const typed = [{ sessionId: 'a', reason: 'typed' as const }];
    const timeout = [{ sessionId: 'a', reason: 'timeout' as const }];
    expect(closedToastMessage(2, 2, 1, undefined, asks)).toBe('Closed 2 agents · 2 summarized to inbox · 1 follow-up filed · 1 kept open (see your inbox).');
    expect(closedToastMessage(1, 1, 0, undefined, typed)).toBe('Closed 1 agent · 1 summarized to inbox · no unfinished work found · 1 kept open.');
    expect(closedToastMessage(0, 0, 0, undefined, asks)).toBe('Kept 1 agent open (see your inbox).');
    expect(closedToastMessage(0, 0, 0, undefined, [...typed, ...timeout])).toBe('Kept 2 agents open (see your inbox).');
    expect(closedToastMessage(0, 0, 0, undefined, typed)).toBe('Kept 1 agent open.');
    // Kept open after its record was written (a key or new work during the write): the summary still counts.
    expect(closedToastMessage(0, 1, 1, undefined, typed)).toBe('Kept 1 agent open · 1 summarized to inbox (see your inbox).');
    expect(closedToastMessage(0, 0, 0, undefined, [{ sessionId: 'a', reason: 'turn-error' as const }])).toBe('Kept 1 agent open (see your inbox).');
  });

  it('keeps today\'s closed toast with default arguments', () => {
    expect(closedToastMessage(2, 1, 1)).toBe('Closed 2 agents · 1 summarized to inbox · 1 follow-up filed.');
    expect(closedToastMessage(1, 0, 0)).toBe('Closed 1 agent · no readable transcript found.');
  });
});
