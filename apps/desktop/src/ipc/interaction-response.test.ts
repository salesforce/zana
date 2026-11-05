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

import { NativeSheetRequiredError } from '../interaction-proof.js';

const sheetInput = { threadId: 't', interactionId: 'i', value: { ok: true } };
const liveWin = { id: 7, isDestroyed: () => false };
const app = { id: 'p', name: 'Plan Plugin', enabled: true, status: 'running' };
function wire(overrides: { outcome?: 'approved' | 'cancelled'; apps?: typeof app[]; withSheet?: boolean } = {}) {
  const register = vi.fn();
  const respond = vi.fn()
    .mockRejectedValueOnce(new NativeSheetRequiredError('Approve plan', 'p'))
    .mockResolvedValue({ resolution: { actor: 'human' } });
  const showSheet = vi.fn(async () => (overrides.outcome === 'cancelled' ? { kind: 'cancelled' as const } : { kind: 'approved' as const, typed: '' }));
  const listApps = vi.fn(async () => overrides.apps ?? [app]);
  registerInteractionResponseIpc(register, respond as never, overrides.withSheet === false ? undefined : { listApps, showSheet: showSheet as never });
  return { handler: register.mock.calls[0]![1], respond, showSheet };
}

it('draws a main-owned sheet for native-sheet and retries with a sheet source', async () => {
  const { handler, respond, showSheet } = wire();
  await expect(handler(liveWin, sheetInput)).resolves.toEqual({ resolution: { actor: 'human' } });
  expect(respond).toHaveBeenNthCalledWith(1, sheetInput, 'human', 'window:7');
  expect(respond).toHaveBeenNthCalledWith(2, sheetInput, 'human', 'sheet:7');
  const view = showSheet.mock.calls[0]![1] as { pluginName: string; request: { title: string; details: string[] } };
  expect(view.pluginName).toBe('Plan Plugin');
  expect(view.request.title).toBe('Approve plan');
  expect(view.request.details[0]).toContain('"ok":true');
});

it.each([
  ['the person cancels', { outcome: 'cancelled' as const }],
  ['the plugin is not running', { apps: [{ ...app, status: 'stopped' }] }],
  ['the plugin is unknown', { apps: [] }],
  ['main has no sheet wired', { withSheet: false }]
])('fails closed when %s', async (_name, overrides) => {
  const { handler, respond } = wire(overrides);
  await expect(handler(liveWin, sheetInput)).rejects.toThrow('approval sheet');
  expect(respond).toHaveBeenCalledTimes(1);
});

it('passes other failures straight through without a sheet', async () => {
  const register = vi.fn();
  const respond = vi.fn().mockRejectedValue(new Error('Human proof required'));
  const showSheet = vi.fn();
  registerInteractionResponseIpc(register, respond as never, { listApps: async () => [app], showSheet });
  await expect(register.mock.calls[0]![1](liveWin, sheetInput)).rejects.toThrow('Human proof required');
  expect(showSheet).not.toHaveBeenCalled();
});
