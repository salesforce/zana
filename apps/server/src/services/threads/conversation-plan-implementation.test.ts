import { describe, expect, it, vi } from 'vitest';
import { assertPlanImplementationReady, assertPlanRevision, planImplementationMode, planImplementationPrompt } from './conversation-plan-implementation.js';
import { getDurableThreadPlanView } from './conversation-plan.js';
vi.mock('./conversation-plan.js', () => ({ getDurableThreadPlanView: vi.fn() }));

const thread = { id: 'one', hostId: 'host', status: 'idle', archivedAt: null };
function context(pending = false, connected = true) {
  vi.mocked(getDurableThreadPlanView).mockReturnValue({ markdown: '# Saved plan', revision: 2 } as never);
  return { db: {}, pendingInteractions: { hasPendingThreadInteraction: () => pending }, hostHub: { connectedHostIds: () => connected ? ['host'] : [] } } as never;
}
describe('reviewed plan implementation', () => {
  it('uses the saved document and exact revision', () => {
    const ctx = context();
    expect(assertPlanRevision(ctx, 'one', 2)).toBe('# Saved plan');
    expect(() => assertPlanImplementationReady(ctx, thread as never, 2)).not.toThrow();
    expect(planImplementationPrompt('# Saved plan', 2)).toContain('(revision 2)');
    expect(planImplementationPrompt('# Saved plan', 2)).toContain('# Saved plan');
  });
  it.each([0, -1, 1.5, NaN, Infinity])('rejects invalid revision %s', revision => {
    expect(() => assertPlanRevision(context(), 'one', revision)).toThrow('saved plan revision');
  });
  it('rejects missing and stale documents', () => {
    const ctx = context();
    expect(() => assertPlanRevision(ctx, 'one', 1)).toThrow('plan changed');
    vi.mocked(getDurableThreadPlanView).mockReturnValue(null);
    expect(() => assertPlanRevision(ctx, 'one', 2)).toThrow('Write a plan');
  });
  it.each(['active', 'starting', 'stopping'])('rejects a %s thread', status => {
    expect(() => assertPlanImplementationReady(context(), { ...thread, status } as never, 2)).toThrow();
  });
  it('rejects archived, disconnected, and pending-interaction threads', () => {
    expect(() => assertPlanImplementationReady(context(), { ...thread, archivedAt: 1 } as never, 2)).toThrow('archived');
    expect(() => assertPlanImplementationReady(context(true), thread as never, 2)).toThrow('pending interaction');
    expect(() => assertPlanImplementationReady(context(false, false), thread as never, 2)).toThrow('Connect the host');
  });
  it.each([undefined, '', 'agent', 'build', 'code', 'execute'])('accepts execution mode %s', mode => {
    expect(planImplementationMode(mode)).toBe(mode ?? '');
  });
  it('requires an explicit execution selection when exiting native Plan mode', () => {
    expect(() => planImplementationMode(undefined, 'plan')).toThrow('Select an Agent mode');
    expect(planImplementationMode('build', 'plan')).toBe('build');
    expect(planImplementationMode(undefined, 'agent')).toBe('');
  });
  it.each(['plan', 'ask', 'custom', 3, null])('rejects non-execution mode %s', mode => {
    expect(() => planImplementationMode(mode)).toThrow('execution mode');
  });
});
