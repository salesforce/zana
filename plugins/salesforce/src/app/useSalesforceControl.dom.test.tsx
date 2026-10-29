/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { closeSalesforceControls, controlText, useSalesforceControl } from './useSalesforceControl.js';
const rpc = vi.fn(); const queued: unknown[] = [];
function Surface({ enabled = true, projectId = 'p' }) {
  const [view, setView] = useState('overview');
  useSalesforceControl({ pluginId: 'salesforce', projectId, surface: 'workbench', enabled, commands: ['state', 'view.open'], state: () => ({ view }), execute: ({ input }) => { const next = controlText(input, 'view', 20); if (next === 'fail') throw Error('Cannot switch'); setView(next); } });
  return <div>{view}</div>;
}
beforeEach(() => {
  vi.useFakeTimers(); queued.length = 0; rpc.mockReset();
  rpc.mockImplementation(async (_id, method) => method === 'control.register' ? { ok: true, viewId: 'view' } : method === 'control.poll' ? { ok: true, commands: queued.splice(0) } : { ok: true });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc };
});
afterEach(() => { cleanup(); vi.useRealTimers(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; });
it('executes commands and acknowledges the committed UI, including errors', async () => {
  const mounted = render(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  queued.push({ id: 'one', command: 'view.open', input: { view: 'agentforce' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText('agentforce')).toBeTruthy();
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.ack', expect.objectContaining({ commandId: 'one', ok: true, state: { view: 'agentforce' }, projectId: 'p' }));
  queued.push({ id: 'two', command: 'view.open', input: { view: 'fail' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1501); });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.ack', expect.objectContaining({ commandId: 'two', ok: false, error: 'Cannot switch' }));
  mounted.unmount(); expect(rpc).toHaveBeenCalledWith('salesforce', 'control.close', expect.objectContaining({ viewId: 'view' }));
});
it('does not register disabled or unscoped views and retries a failed lease', async () => {
  const mounted = render(<Surface enabled={false} />); expect(rpc).not.toHaveBeenCalled();
  mounted.rerender(<Surface projectId="" />); expect(rpc).not.toHaveBeenCalled();
  rpc.mockRejectedValueOnce(Error('reloading'));
  mounted.rerender(<Surface />); await act(async () => { await vi.advanceTimersByTimeAsync(1501); });
  expect(rpc.mock.calls.filter(row => row[1] === 'control.register')).toHaveLength(2);
  expect(() => controlText({ view: 2 }, 'view')).toThrow('Provide');
});
it('releases a lease that registered after unmount', async () => {
  let finish!: (value: unknown) => void; rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const mounted = render(<Surface />); mounted.unmount();
  await act(async () => { finish({ ok: true, viewId: 'late' }); });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.close', expect.objectContaining({ viewId: 'late' }));
});

it('preflights all local project leases and stops renewal without closing other projects', async () => {
  render(<><Surface /><Surface /><Surface projectId="other" /></>);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  await act(async () => { await closeSalesforceControls('p'); });
  expect(rpc.mock.calls.filter(row => row[1] === 'control.close' && row[2].projectId === 'p')).toHaveLength(2);
  expect(rpc.mock.calls.filter(row => row[1] === 'control.close' && row[2].projectId === 'other')).toHaveLength(0);
  rpc.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(rpc.mock.calls.filter(row => row[1] === 'control.poll').every(row => row[2].projectId === 'other')).toBe(true);
  await closeSalesforceControls('p');
  expect(rpc.mock.calls.some(row => row[1] === 'control.close')).toBe(false);
});
it('awaits an in-flight registration before acknowledging native close', async () => {
  let finish!: (value: unknown) => void;
  rpc.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<Surface />);
  let settled = false;
  const closing = closeSalesforceControls('p').then(() => { settled = true; });
  await act(async () => { await Promise.resolve(); });
  expect(settled).toBe(false);
  await act(async () => { finish({ ok: true, viewId: 'late' }); await closing; });
  expect(rpc).toHaveBeenCalledWith('salesforce', 'control.close', expect.objectContaining({ viewId: 'late' }));
  expect(rpc.mock.calls.some(row => row[1] === 'control.poll')).toBe(false);
});
it('rejects a failed close acknowledgement and permits retry', async () => {
  render(<Surface />);
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  rpc.mockImplementationOnce(async () => ({ ok: false, error: 'Cannot release view' }));
  await expect(closeSalesforceControls('p')).rejects.toThrow('Cannot release view');
  await closeSalesforceControls('p');
  expect(rpc.mock.calls.filter(row => row[1] === 'control.close')).toHaveLength(2);
});
