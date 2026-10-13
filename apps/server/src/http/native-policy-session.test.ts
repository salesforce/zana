import { describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from './product-context.js';
import { nativePolicySession } from './native-policy-session.js';

function context(value?: unknown) {
  const get = vi.fn(async () => value);
  const ctx = { terminalSessions: new Map(), cliAgentOps: { get } } as unknown as ProductHttpContext;
  return { ctx, get };
}
const live = { id: 'native', projectId: 'project', profile: 'codex', status: 'running' };

describe('native policy session identity', () => {
  it('uses the desktop CLI owner for sessions absent from the shell registry', async () => {
    const { ctx, get } = context({ ok: true, value: live });
    expect(await nativePolicySession(ctx, 'native')).toEqual({ id: 'native', projectId: 'project', profile: 'codex' });
    expect(get).toHaveBeenCalledWith('native');
  });
  it('uses registered shell identity without querying the CLI owner', async () => {
    const { ctx, get } = context();
    ctx.terminalSessions.set('native', live as never);
    expect(await nativePolicySession(ctx, 'native')).toBe(live);
    expect(get).not.toHaveBeenCalled();
    ctx.terminalSessions.set('native', { ...live, status: 'exited' } as never);
    expect(await nativePolicySession(ctx, 'native')).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
  it.each([
    null, {}, { ok: false, code: 'NOT_FOUND' }, { ok: true, value: null }, { ok: true, value: [] },
    ...[{ id: 'other' }, { projectId: '' }, { projectId: 1 }, { profile: '' }, { profile: 1 }, { status: 'exited' }, { status: undefined }]
      .map(change => ({ ok: true, value: { ...live, ...change } }))
  ])('fails closed on missing or malformed authoritative identity: %j', async value => {
    const { ctx } = context(value);
    expect(await nativePolicySession(ctx, 'native')).toBeNull();
  });
  it('fails closed when disconnected or when the control owner throws', async () => {
    const { ctx, get } = context();
    get.mockRejectedValueOnce(new Error('disconnected'));
    expect(await nativePolicySession(ctx, 'native')).toBeNull();
    ctx.cliAgentOps = undefined;
    expect(await nativePolicySession(ctx, 'native')).toBeNull();
  });
});
