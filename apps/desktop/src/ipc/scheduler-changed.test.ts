import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerSchedulerIpc } from './scheduler.js';

const h = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  rows: [] as Array<Record<string, unknown>>,
  safeSend: vi.fn()
}));
vi.mock('./shared-product-registration.js', () => ({ productHandle: () => {}, safeProductHandle: () => {} }));
vi.mock('./ctx.js', () => ({ ctx: {
  scheduler: { on: (event: string, listener: () => void) => h.listeners.set(event, listener) },
  goals: { on: vi.fn() }, followups: { on: vi.fn() }, feedStore: { on: vi.fn() },
  templates: { on: vi.fn() }, scheduleGroups: { on: vi.fn() },
  safeSend: h.safeSend
} }));
vi.mock('./shared.js', () => ({
  isExternalId: () => false, externalReject: () => ({ ok: false }), listSchedulesForUi: () => h.rows
}));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [] } }));

beforeEach(() => {
  h.listeners.clear(); h.safeSend.mockReset();
  h.rows = [{ id: 'native-1', name: 'Nightly' }];
  registerSchedulerIpc();
});

const scheduleSends = () => h.safeSend.mock.calls.filter(([channel]) => channel === IPC.scheduler.onChanged);

describe('scheduler change publishing', () => {
  it('always publishes on changed and skips unchanged polls', () => {
    h.listeners.get('changed')!();
    h.listeners.get('changed')!();
    h.listeners.get('polled')!();
    expect(scheduleSends()).toHaveLength(2);
  });

  it('publishes a poll when only a Claude /loop row changed', () => {
    h.listeners.get('polled')!();
    h.rows = [...h.rows, { id: 'claude-loop:a', name: 'Loop', external: { kind: 'claude-loop' } }];
    h.listeners.get('polled')!();
    h.listeners.get('polled')!();
    expect(scheduleSends()).toHaveLength(2);
    expect(scheduleSends()[1]![1]).toEqual(h.rows);
  });

  it('ignores the now-stamped timestamps of loop rows between polls', () => {
    h.rows = [{ id: 'claude-loop:a', external: { kind: 'claude-loop' }, createdAt: 't1', updatedAt: 't1' }];
    h.listeners.get('polled')!();
    h.rows = [{ id: 'claude-loop:a', external: { kind: 'claude-loop' }, createdAt: 't2', updatedAt: 't2' }];
    h.listeners.get('polled')!();
    expect(scheduleSends()).toHaveLength(1);
  });
});
