// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { product } from '../product-client.js';

afterEach(() => vi.unstubAllGlobals());

it.each(['queued', 'failed'])('confirms and sends the selected %s message from a phone', async status => {
  const confirm = vi.fn(() => true);
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ items: [
      { id: 'other', text: 'Other prompt', status: 'queued', updatedAt: 1 },
      { id: 'item', text: 'Selected prompt', status, updatedAt: 2 }
    ] }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('window', { confirm });
  vi.stubGlobal('fetch', fetch);

  await expect(product.threads.sendNextTurn('thread/one', 'item')).resolves.toEqual({ ok: true });
  expect(confirm).toHaveBeenCalledExactlyOnceWith('Send this queued message now?\n\nSelected prompt');
  expect(fetch.mock.calls[0][0]).toBe('/api/v1/threads/thread%2Fone/next-turn');
  expect(fetch.mock.calls[1][0]).toBe('/api/v1/threads/thread%2Fone/next-turn/item/send');
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ confirmed: true, expectedUpdatedAt: 2 });
});

it('keeps a phone cancellation from sending and bounds the confirmation preview', async () => {
  const confirm = vi.fn(() => false);
  const fetch = vi.fn().mockResolvedValue(Response.json({ items: [
    { id: 'item', text: `\n${'a'.repeat(400)}\n`, status: 'queued', updatedAt: 2 }
  ] }));
  vi.stubGlobal('window', { confirm });
  vi.stubGlobal('fetch', fetch);
  await expect(product.threads.sendNextTurn('thread', 'item')).rejects.toThrow('Send now was cancelled');
  expect(confirm).toHaveBeenCalledWith(`Send this queued message now?\n\n${'a'.repeat(240)}…`);
  expect(fetch).toHaveBeenCalledOnce();
});

it.each(['missing', 'dispatching'])('does not confirm or send a %s queue item', async state => {
  const confirm = vi.fn();
  const fetch = vi.fn().mockResolvedValue(Response.json({ items: state === 'missing' ? [] : [
    { id: 'item', text: 'Already sending', status: state, updatedAt: 2 }
  ] }));
  vi.stubGlobal('window', { confirm });
  vi.stubGlobal('fetch', fetch);
  await expect(product.threads.sendNextTurn('thread', 'item')).rejects.toThrow('Queued message is unavailable');
  expect(confirm).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledOnce();
});

it('preserves a server refusal after phone confirmation', async () => {
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ items: [{ id: 'item', text: 'Selected', status: 'queued', updatedAt: 2 }] }))
    .mockResolvedValueOnce(Response.json({ error: 'dispatch_not_overrideable', message: 'Cannot override this wait' }, { status: 409 }));
  vi.stubGlobal('window', { confirm: vi.fn(() => true) });
  vi.stubGlobal('fetch', fetch);
  await expect(product.threads.sendNextTurn('thread', 'item')).rejects.toMatchObject({ code: 'dispatch_not_overrideable', status: 409 });
});

it('forwards Send now through the desktop bridge and returns its result', async () => {
  const result = { ok: true };
  const sendNextTurn = vi.fn().mockResolvedValue(result);
  const fetch = vi.fn();
  vi.stubGlobal('window', { cc: { threads: { sendNextTurn } } });
  vi.stubGlobal('fetch', fetch);

  await expect(product.threads.sendNextTurn('thread/one', 'item two')).resolves.toBe(result);
  expect(sendNextTurn).toHaveBeenCalledExactlyOnceWith('thread/one', 'item two');
  expect(fetch).not.toHaveBeenCalled();
});
