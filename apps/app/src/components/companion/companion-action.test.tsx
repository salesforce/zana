// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { companionAction, useCompanionAction } from './companion-action.js';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('owns synchronous and asynchronous failures with contextual diagnostics', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const recover = vi.fn();
  companionAction('move rail', () => { throw new Error('sync'); }, recover);
  companionAction('close panel', () => Promise.reject(new Error('async')), recover);
  companionAction('cleanup', () => Promise.reject(new Error('no recovery')));
  await act(async () => {});
  expect(recover).toHaveBeenCalledTimes(2);
  expect(log).toHaveBeenCalledWith('[companion] move rail:', expect.any(Error));
  expect(log).toHaveBeenCalledWith('[companion] close panel:', expect.any(Error));
});

it('shows actionable failures, resets them on retry, and ignores post-unmount failures', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const { result, unmount } = renderHook(useCompanionAction);
  const recover = vi.fn();
  await act(async () => result.current.run('open Zana', () => Promise.reject(new Error('ipc')), recover));
  expect(result.current.error).toBe('Could not open Zana. Try again.');
  expect(recover).toHaveBeenCalledOnce();
  act(() => result.current.run('open Zana', () => undefined));
  expect(result.current.error).toBeNull();
  let fail!: (err: Error) => void;
  act(() => result.current.run('open Zana', () => new Promise((_, reject) => { fail = reject; })));
  unmount();
  await act(async () => fail(new Error('late')));
});
