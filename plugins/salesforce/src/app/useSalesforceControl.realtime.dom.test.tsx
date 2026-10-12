/** @vitest-environment happy-dom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { isPendingUser, POLL_MS_FALLBACK, POLL_MS_HIDDEN, POLL_MS_REALTIME, useSalesforceControl, viewPresence } from './useSalesforceControl.js';

const rpc = vi.fn(); const queued: unknown[] = [];
let wakeHandler: ((payload: unknown) => void) | undefined; let connection = 'connected';
let execute: (command: any) => any = () => undefined;
function Surface() {
  useSalesforceControl({ pluginId: 'salesforce', projectId: 'p', surface: 'agentforce', commands: ['state'], state: () => ({ ok: 1 }), execute: command => execute(command) });
  return null;
}
const polls = () => rpc.mock.calls.filter(row => row[1] === 'control.poll').length;
beforeEach(() => {
  vi.useFakeTimers(); queued.length = 0; rpc.mockReset(); wakeHandler = undefined; connection = 'connected'; execute = () => undefined;
  rpc.mockImplementation(async (_id, method) => method === 'control.register' ? { ok: true, viewId: 'view' } : method === 'control.poll' ? { ok: true, commands: queued.splice(0) } : { ok: true });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = { useRealtime: (_c: string, h: (p: unknown) => void) => { wakeHandler = h; }, useRealtimeConnectionState: () => connection };
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });

it('polls every 5s while realtime is connected and wakes immediately for its own viewId only', async () => {
  render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS_FALLBACK + 100); });
  expect(polls()).toBe(1);
  queued.push({ id: 'one', command: 'state', input: {} });
  await act(async () => { wakeHandler!({ viewId: 'someone-else' }); wakeHandler!(null); wakeHandler!({ viewId: 5 }); await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(1);
  await act(async () => { wakeHandler!({ viewId: 'view' }); await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(2);
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.ack', expect.objectContaining({ commandId: 'one', ok: true }));
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS_REALTIME + 10); });
  expect(polls()).toBe(3);
});

it('falls back to 1.5s polling when realtime is not connected', async () => {
  connection = 'reconnecting';
  render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS_FALLBACK + 10); });
  expect(polls()).toBe(2);
});

it('coalesces a wake that arrives during an in-flight poll into one extra poll', async () => {
  let release!: () => void;
  rpc.mockImplementation(async (_id, method) => {
    if (method === 'control.register') return { ok: true, viewId: 'view' };
    if (method === 'control.poll') { if (polls() === 1) await new Promise<void>(r => { release = r; }); return { ok: true, commands: [] }; }
    return { ok: true };
  });
  render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { wakeHandler!({ viewId: 'view' }); wakeHandler!({ viewId: 'view' }); });
  expect(polls()).toBe(1);
  await act(async () => { release(); await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(2);
});

it('acks pending:user, then reports the settled outcome through control.outcome', async () => {
  let settle!: (value: unknown) => void;
  execute = () => ({ pending: 'user', proposalId: 'prop', settled: new Promise(r => { settle = r; }), path: 'a.agent' });
  render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  queued.push({ id: 'cmd', command: 'state', input: {} });
  await act(async () => { wakeHandler!({ viewId: 'view' }); await vi.advanceTimersByTimeAsync(1); });
  const ack = rpc.mock.calls.find(row => row[1] === 'control.ack')![2];
  expect(ack).toMatchObject({ commandId: 'cmd', ok: true, pending: 'user', proposalId: 'prop', state: { ok: 1, path: 'a.agent' } });
  expect(ack.state.settled).toBeUndefined();
  expect(rpc.mock.calls.some(row => row[1] === 'control.outcome')).toBe(false);
  const outcome = { outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0 };
  await act(async () => { settle(outcome); await vi.advanceTimersByTimeAsync(1); });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.outcome', expect.objectContaining({ viewId: 'view', commandId: 'cmd', outcome }));
});

it('reports a rejected proposal as a rejected outcome and stays silent after unmount', async () => {
  let fail!: (error: unknown) => void;
  execute = () => ({ pending: 'user', proposalId: 'prop', settled: new Promise((_r, rej) => { fail = rej; }) });
  const mounted = render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  queued.push({ id: 'cmd', command: 'state', input: {} });
  await act(async () => { wakeHandler!({ viewId: 'view' }); await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { fail(Error('editor closed')); await vi.advanceTimersByTimeAsync(1); });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.outcome', expect.objectContaining({ outcome: expect.objectContaining({ outcome: 'rejected', note: 'editor closed' }) }));
  rpc.mockClear();
  execute = () => ({ pending: 'user', proposalId: 'p2', settled: new Promise(r => { setTimeout(() => r({ outcome: 'accepted', acceptedHunks: 0, rejectedHunks: 0 }), 50); }) });
  queued.push({ id: 'two', command: 'state', input: {} });
  await act(async () => { wakeHandler!({ viewId: 'view' }); await vi.advanceTimersByTimeAsync(1); });
  mounted.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(rpc.mock.calls.some(row => row[1] === 'control.outcome')).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('isPendingUser only matches complete pending results', () => {
  expect(isPendingUser({ pending: 'user', proposalId: 'x', settled: Promise.resolve() })).toBe(true);
  for (const value of [null, undefined, {}, { pending: 'user', proposalId: 'x' }, { pending: 'user', settled: Promise.resolve() }]) expect(isPendingUser(value)).toBe(false);
});

it('registers its host window and reports presence with every poll', async () => {
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__.useZccContext = () => ({ projectId: 'p', threadId: null, surface: 'plugin-view' });
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.register', expect.objectContaining({ surface: 'agentforce', window: 'plugin-view' }));
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.poll', expect.objectContaining({ presence: { visible: true, focused: true } }));
  focus.mockRestore();
});

it('polls at once when focus or visibility changes, and only keeps the lease alive while hidden', async () => {
  let state: DocumentVisibilityState = 'visible';
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => state);
  const mounted = render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(rpc.mock.calls.find(row => row[1] === 'control.register')![2]).not.toHaveProperty('window');
  await act(async () => { window.dispatchEvent(new Event('blur')); await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(2);
  state = 'hidden';
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(3);
  expect(rpc.mock.calls.filter(row => row[1] === 'control.poll').at(-1)![2]).toMatchObject({ presence: { visible: false } });
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS_REALTIME + 10); });
  expect(polls()).toBe(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(POLL_MS_HIDDEN - POLL_MS_REALTIME); });
  expect(polls()).toBe(4);
  // A wake still delivers to a hidden window right away.
  await act(async () => { wakeHandler!({ viewId: 'view' }); await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(5);
  state = 'visible';
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(1); });
  expect(polls()).toBe(6);
  mounted.unmount();
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(POLL_MS_HIDDEN); });
  expect(polls()).toBe(6);
  visibility.mockRestore();
});

it('drops its lease when the window unloads', async () => {
  const mounted = render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(1); });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.close', expect.objectContaining({ viewId: 'view' }));
  mounted.unmount();
  rpc.mockClear();
  await act(async () => { window.dispatchEvent(new Event('pagehide')); await vi.advanceTimersByTimeAsync(1); });
  expect(rpc).not.toHaveBeenCalled();
});

it('reads presence from the document', () => {
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  expect(viewPresence()).toEqual({ visible: true, focused: false });
  focus.mockRestore();
});
