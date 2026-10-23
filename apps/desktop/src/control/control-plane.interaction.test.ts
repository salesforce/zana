import { expect, it, vi } from 'vitest';
import { authorizeRequest, classifyCaller, dispatchOp, type ControlPlaneDeps } from './control-plane.js';

it('uses authenticated caller class, ignores actor spoofing, and exposes only bounded response op', async () => {
  const respondInteraction = vi.fn(async (_input, actor) => {
    if (actor !== 'human') throw new Error('Human proof required');
    return { resolution: { actor } };
  });
  const deps = { respondInteraction } as unknown as ControlPlaneDeps;
  const args = { threadId: 't', interactionId: 'i', value: true, actor: 'human' };
  for (const callerSessionId of ['agent', 'stale', 'forged']) {
    const request = authorizeRequest({ token: 'token', nonce: 'nonce', op: 'interaction.respond', callerSessionId, args }, { token: 'token', nonce: 'nonce' });
    expect(request).toMatchObject({ ok: true, caller: 'agent' });
    expect(await dispatchOp('interaction.respond', args, deps, { class: 'agent' })).toMatchObject({ ok: false, code: 'INTERACTION_REFUSED', message: 'Human proof required' });
  }
  expect(await dispatchOp('interaction.respond', args, deps, { class: 'orchestrator' })).toMatchObject({ ok: false });
  expect(await dispatchOp('interaction.respond', args, deps)).toEqual({ ok: true, value: { resolution: { actor: 'human' } } });
  expect(await dispatchOp('interaction.respond', args, {} as ControlPlaneDeps)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
  expect(classifyCaller(undefined, undefined, 'agent-token')).toBe('agent');
});
