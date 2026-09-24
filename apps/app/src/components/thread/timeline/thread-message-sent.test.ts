import { afterEach, expect, it, vi } from 'vitest';
import { dispatchThreadMessageSent, THREAD_MESSAGE_SENT_EVENT, THREAD_OPTIMISTIC_USER_EVENT } from './thread-optimistic-events.js';

afterEach(() => vi.unstubAllGlobals());

it('ignores missing browser or thread scope', () => {
  vi.stubGlobal('window', undefined);
  expect(() => dispatchThreadMessageSent('thread-1')).not.toThrow();
  const browser = new EventTarget();
  const sent = vi.fn();
  browser.addEventListener(THREAD_MESSAGE_SENT_EVENT, sent);
  vi.stubGlobal('window', browser);
  dispatchThreadMessageSent('');
  expect(sent).not.toHaveBeenCalled();
});

it('announces accepted sends without inserting an optimistic conversation row', () => {
  const browser = new EventTarget();
  const sent = vi.fn();
  const optimistic = vi.fn();
  browser.addEventListener(THREAD_MESSAGE_SENT_EVENT, sent);
  browser.addEventListener(THREAD_OPTIMISTIC_USER_EVENT, optimistic);
  vi.stubGlobal('window', browser);
  dispatchThreadMessageSent('thread-1');
  expect(sent).toHaveBeenCalledOnce();
  expect(sent.mock.calls[0][0].detail).toEqual({ threadId: 'thread-1' });
  expect(optimistic).not.toHaveBeenCalled();
});
