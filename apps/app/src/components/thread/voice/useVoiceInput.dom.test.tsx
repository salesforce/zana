// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ captures: [] as any[], toast: vi.fn(), available: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { voice: { hasApiKey: mocks.available } } }));
vi.mock('../../../store.js', () => ({ useUi: (select: any) => select({ pushToast: mocks.toast }) }));
vi.mock('./voice-session.js', () => ({ createVoiceCapture: (_deps: any, callbacks: any) => {
  const session = {
    callbacks,
    start: vi.fn(async () => callbacks.onState('recording')),
    stop: vi.fn(() => callbacks.onState('transcribing')),
    cancel: vi.fn(() => callbacks.onState('idle')),
    retry: vi.fn(), canRetry: vi.fn(() => true), dispose: vi.fn()
  };
  mocks.captures.push(session);
  return session;
} }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mocks.captures.length = 0;
  mocks.available.mockResolvedValue(true);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
  vi.stubGlobal('MediaRecorder', class {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps accepted audio and its original callback across navigation and remount', async () => {
  const { useVoiceInput } = await import('./useVoiceInput.js');
  const original = vi.fn(), replacement = vi.fn();
  const first = renderHook(() => useVoiceInput({ ownerKey: 'a', onTranscript: original }));
  await waitFor(() => expect(first.result.current.canStart).toBe(true));
  await act(() => first.result.current.start());
  act(() => first.result.current.stop()); first.unmount();
  expect(mocks.captures[0].dispose).toHaveBeenCalledWith({ preserveTranscription: true });
  const second = renderHook(() => useVoiceInput({ ownerKey: 'a', onTranscript: replacement }));
  expect(second.result.current.state).toBe('transcribing');
  act(() => { mocks.captures[0].callbacks.onTranscript('owned'); mocks.captures[0].callbacks.onState('idle'); });
  expect(original).toHaveBeenCalledWith('owned'); expect(replacement).not.toHaveBeenCalled();
  expect(mocks.captures).toHaveLength(1);
  second.unmount();
});

it('freezes the send callback, exposes retry, and releases cancelled captures', async () => {
  const { useVoiceInput } = await import('./useVoiceInput.js');
  const insert = vi.fn(), send = vi.fn();
  const hook = renderHook(() => useVoiceInput({ ownerKey: 'send', onTranscript: insert }));
  await waitFor(() => expect(hook.result.current.canStart).toBe(true));
  await act(() => hook.result.current.start());
  act(() => hook.result.current.stop(send));
  act(() => mocks.captures[0].callbacks.onTranscript('message'));
  expect(send).toHaveBeenCalledWith('message'); expect(insert).not.toHaveBeenCalled();
  act(() => mocks.captures[0].callbacks.onState('error'));
  expect(hook.result.current.canRetry).toBe(true); hook.result.current.retry();
  expect(mocks.captures[0].retry).toHaveBeenCalledOnce();
  act(() => hook.result.current.cancel()); expect(hook.result.current.state).toBe('idle');
});

it('bounds pending recordings without evicting another owner', async () => {
  const { useVoiceInput } = await import('./useVoiceInput.js');
  for (const key of ['a', 'b', 'c']) {
    const hook = renderHook(() => useVoiceInput({ ownerKey: key, onTranscript: vi.fn() }));
    await waitFor(() => expect(hook.result.current.canStart).toBe(true));
    await act(() => hook.result.current.start()); act(() => hook.result.current.stop()); hook.unmount();
  }
  const fourth = renderHook(() => useVoiceInput({ ownerKey: 'd', onTranscript: vi.fn() }));
  await waitFor(() => expect(fourth.result.current.canStart).toBe(true));
  await act(() => fourth.result.current.start());
  expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('pending recording'), 'error');
  expect(mocks.captures[3].start).not.toHaveBeenCalled();
  for (const capture of mocks.captures.slice(0, 3)) expect(capture.dispose).toHaveBeenCalledTimes(1);
});

it('blocks unavailable voice and honours the disabled option', async () => {
  mocks.available.mockResolvedValue(false);
  const { useVoiceInput } = await import('./useVoiceInput.js');
  const hook = renderHook(() => useVoiceInput({ onTranscript: vi.fn(), enabled: false }));
  expect(mocks.available).not.toHaveBeenCalled();
  await act(() => hook.result.current.start());
  expect(hook.result.current.state).toBe('error'); expect(mocks.captures[0].start).not.toHaveBeenCalled();
});
