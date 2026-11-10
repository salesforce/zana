import { beforeEach, expect, it, vi } from 'vitest';
import { callControlPlane } from '../control-client.js';
import { runThreadCommand } from './thread.js';

vi.mock('../control-client.js', () => ({ callControlPlane: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

it.each([
  ['thread', 'respond'],
  ['thread', 'respond', 'interaction'],
  ['thread', 'respond', 'interaction', '--value', 'not-json']
])('rejects invalid response arguments %j before contacting main', async (...args) => {
  expect((await runThreadCommand('interactions', args, true, undefined, '/data')).exitCode).toBe(2);
  expect(callControlPlane).not.toHaveBeenCalled();
});

it('sends JSON value through control transport and renders response', async () => {
  const value = { resolution: { actor: 'human' } };
  vi.mocked(callControlPlane).mockResolvedValue({ ok: true, value });
  for (const json of [false, true]) {
    const result = await runThreadCommand('interactions', ['thread', 'respond', 'interaction', '--value', 'null'], json, undefined, '/data');
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(value);
  }
  expect(callControlPlane).toHaveBeenCalledWith({ dataDir: '/data', op: 'interaction.respond', args: { threadId: 'thread', interactionId: 'interaction', value: null } });
});

it.each([
  [{ ok: false, code: 'INTERACTION_REFUSED', message: 'Human proof required' }, 5, 'Human proof required'],
  [{ ok: false, code: 'APP_NOT_RUNNING' }, 1, 'Interaction refused']
])('preserves refusal exit codes', async (response, code, message) => {
  vi.mocked(callControlPlane).mockResolvedValue(response);
  const result = await runThreadCommand('interactions', ['thread', 'respond', 'interaction', '--value', 'true'], true, undefined, '/data');
  expect(result.exitCode).toBe(code);
  expect(result.stderr).toContain(message);
});
