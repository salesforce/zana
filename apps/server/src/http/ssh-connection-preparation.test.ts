import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { expect, it, vi } from 'vitest';
import type { ProductHttpContext } from './product-context.js';
import { prepareSshConnection } from './ssh-connection-preparation.js';
import { SshPreparationError } from '../plugins/ssh-connection-providers.js';

function fixture() {
  const response = Object.assign(new EventEmitter(), { destroyed: false });
  const prepare = vi.fn(async (_remote, _signal, notify) => { notify('Provider'); });
  const ctx = { plugins: { prepareSshConnection: prepare } } as unknown as ProductHttpContext;
  const emit = vi.fn(); const run = () => prepareSshConnection(ctx, response as ServerResponse, { host: 'managed' }, emit);
  return { response, prepare, ctx, emit, run };
}
it('shows preparation before SSH and cleans the disconnect listener', async () => {
  const f = fixture(); expect(await f.run()).toBe(true);
  expect(f.emit.mock.calls.map(([e]) => [e.type, e.stage, e.status])).toEqual([
    ['stage', 'prepare', 'running'], ['log', undefined, undefined], ['stage', 'prepare', 'passed']
  ]); expect(f.response.listenerCount('close')).toBe(0);
});
it('leaves generic SSH and contexts without plugins alone', async () => {
  const f = fixture(); f.prepare.mockImplementationOnce(async () => {}); expect(await f.run()).toBe(true); expect(f.emit).not.toHaveBeenCalled();
  delete f.ctx.plugins; expect(await f.run()).toBe(true);
});
it.each([new SshPreparationError('Sign in required'), Error('SECRET')])('stops installation on provider failure with safe output', async error => {
  const f = fixture(); f.prepare.mockRejectedValueOnce(error); expect(await f.run()).toBe(false);
  expect(f.emit.mock.calls.at(-1)?.[0]).toMatchObject({ type: 'error', code: 'connection_preparation_failed' });
  expect(JSON.stringify(f.emit.mock.calls)).not.toContain('SECRET'); expect(f.response.listenerCount('close')).toBe(0);
});
it.each(['before', 'during'])('cancels preparation on response close %s completion', async when => {
  const f = fixture();
  f.prepare.mockImplementationOnce(async (_remote, signal) => {
    if (when === 'during') f.response.emit('close'); signal.throwIfAborted();
  });
  f.response.destroyed = when === 'before';
  expect(await f.run()).toBe(false); expect(f.emit).not.toHaveBeenCalled(); expect(f.response.listenerCount('close')).toBe(0);
});
