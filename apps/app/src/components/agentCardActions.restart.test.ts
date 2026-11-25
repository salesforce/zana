import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ restartSquadWorker: vi.fn() }));
vi.mock('../store.js', () => ({ useData: () => undefined, useIdleTriage: () => undefined, useUi: { getState: () => ({}) } }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: { restartSquadWorker: h.restartSquadWorker } } }));

import { restartAgentCard, squadRestartRefusal } from './agentCardActions.js';

const worker = { projectId: 'p1', session: { id: 's1', cohort: { role: 'worker' } } } as never;
const plain = { projectId: 'p1', session: { id: 's2' } } as never;
const orch = { projectId: 'p1', session: { id: 's3', cohort: { role: 'orchestrator' } } } as never;
const restartTerminal = vi.fn();
const toast = vi.fn();
const run = (c: never) => restartAgentCard(c, { restartTerminal, toast });

beforeEach(() => vi.clearAllMocks());

describe('restartAgentCard', () => {
  it('asks main first for every card and takes its not-squad-worker answer as the plain path', async () => {
    h.restartSquadWorker.mockResolvedValue({ ok: false, reason: 'not-squad-worker' });
    await run(plain);
    await run(orch);
    expect(h.restartSquadWorker).toHaveBeenCalledTimes(2);
    expect(restartTerminal).toHaveBeenCalledTimes(2);
  });
  it('does not trust a renderer cohort copy that says non-worker when main says worker', async () => {
    h.restartSquadWorker.mockResolvedValue({ ok: true });
    await run(plain);
    expect(restartTerminal).not.toHaveBeenCalled();
  });
  it('falls back to a plain restart only for non-worker cards when main cannot answer (web)', async () => {
    h.restartSquadWorker.mockRejectedValue(new Error('requires the desktop app'));
    await run(plain);
    expect(restartTerminal).toHaveBeenCalledTimes(1);
    await run(worker);
    expect(restartTerminal).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledTimes(1);
  });
  it('bounds the toast detail and strips absolute paths', () => {
    const msg = squadRestartRefusal({ reason: 'relaunch-failed', message: `fail /Users/me/proj/a.ts ${'y'.repeat(400)}` });
    expect(msg).not.toContain('/Users/me');
    expect(msg.length).toBeLessThan(200);
  });
  it('routes a worker through main and does not create a plain terminal', async () => {
    h.restartSquadWorker.mockResolvedValue({ ok: true });
    await run(worker);
    expect(h.restartSquadWorker).toHaveBeenCalledWith('s1');
    expect(restartTerminal).not.toHaveBeenCalled();
  });
  it('falls back when main says it is not a Squad worker', async () => {
    h.restartSquadWorker.mockResolvedValue({ ok: false, reason: 'not-squad-worker' });
    await run(worker);
    expect(restartTerminal).toHaveBeenCalledWith('s1', 'p1');
  });
  it('toasts a refusal without a fallback terminal', async () => {
    h.restartSquadWorker.mockResolvedValue({ ok: false, reason: 'run-closing', message: 'the Squad run is closing' });
    await run(worker);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('the Squad run is closing'));
    h.restartSquadWorker.mockResolvedValue({ ok: false, reason: 'busy' });
    await run(worker);
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('busy'));
    expect(restartTerminal).not.toHaveBeenCalled();
  });
  it('toasts when the IPC throws', async () => {
    h.restartSquadWorker.mockRejectedValue(new Error('x'));
    await run(worker);
    expect(toast).toHaveBeenCalled();
    expect(restartTerminal).not.toHaveBeenCalled();
  });
});
