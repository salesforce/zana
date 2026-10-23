import { expect, it, vi } from 'vitest';
import { registerInteractionResponseIpc, INTERACTION_RESPONSE_CHANNEL } from './interaction-response.js';
it('registers sender-verified window handler and never returns proof', async () => {
  const register = vi.fn();
  const respond = vi.fn(async () => ({ resolution: { actor: 'human' } }));
  registerInteractionResponseIpc(register, respond);
  expect(register.mock.calls[0]![0]).toBe(INTERACTION_RESPONSE_CHANNEL);
  const handler = register.mock.calls[0]![1];
  const input = { threadId: 't', interactionId: 'i', value: true };
  await expect(handler({ id: 7, isDestroyed: () => false }, input)).resolves.toEqual({ resolution: { actor: 'human' } });
  expect(respond).toHaveBeenCalledWith(input, 'human', 'window:7');
  await expect(handler({ id: 7, isDestroyed: () => true }, input)).rejects.toThrow('closed');
  expect(() => register.mock.calls[0]![2](new Error('failed'))).toThrow('failed');
});
