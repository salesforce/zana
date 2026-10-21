import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (win: unknown, ...args: unknown[]) => Promise<any>>(),
  windows: new Map<number, { projectId?: string }>(),
  review: vi.fn()
}));

vi.mock('electron', () => ({ dialog: {} }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] } }));
vi.mock('../shared-product-registry.js', () => ({ registerSharedProduct: () => {} }));
vi.mock('../ctx.js', () => ({
  ctx: {
    safeHandle: () => {},
    safeHandleFromWindow: (channel: string, handler: (win: unknown, ...args: unknown[]) => Promise<any>) => { h.handlers.set(channel, handler); },
    get windows() { return h.windows; },
    squadProposals: { review: (...args: unknown[]) => h.review(...args) }
  }
}));

const { registerExecutionBoardIpc } = await import('../execution-board.js');
const { IPC } = await import('@zana-ai/zcc-desktop-contract');

const run = (win: { id: number }, id: unknown) => h.handlers.get(IPC.teams.reviewProposal)!(win, id);

describe('teams:reviewProposal', () => {
  beforeEach(() => {
    h.handlers.clear();
    h.windows.clear();
    h.review.mockReset();
    registerExecutionBoardIpc();
  });

  it('rejects a non-string or empty id without calling the service', async () => {
    expect(await run({ id: 1 }, 42)).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await run({ id: 1 }, '')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(h.review).not.toHaveBeenCalled();
  });

  it('returns the prefill on the ok path and passes the window id', async () => {
    const prefill = { proposalId: 'p1', projectId: 'proj' };
    h.review.mockResolvedValue({ ok: true, value: prefill });
    expect(await run({ id: 7 }, 'p1')).toEqual({ ok: true, value: prefill });
    expect(h.review).toHaveBeenCalledWith(7, 'p1', expect.any(Function));
  });

  it('enforces the window project scope through the allow callback', async () => {
    h.review.mockResolvedValue({ ok: false, code: 'NOT_FOUND', message: 'x' });
    h.windows.set(7, { projectId: 'proj-a' });
    await run({ id: 7 }, 'p1');
    const allow = h.review.mock.calls[0]![2] as (projectId: string) => boolean;
    expect(allow('proj-a')).toBe(true);
    expect(allow('proj-b')).toBe(false);
    // An unscoped window may review any project.
    await run({ id: 8 }, 'p1');
    expect((h.review.mock.calls[1]![2] as (projectId: string) => boolean)('proj-b')).toBe(true);
  });
});
