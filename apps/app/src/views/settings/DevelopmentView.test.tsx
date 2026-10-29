// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { DevelopmentView } from './DevelopmentView.js';
const h = vi.hoisted(() => ({ status: vi.fn(), start: vi.fn(), restart: vi.fn() }));
vi.mock('@/lib/product-client', () => ({ pluginRecovery: { status: h.status, start: h.start }, product: { hosts: { relaunchLocal: h.restart } } }));
const idle = { phase: 'idle', total: 0, restored: [], failed: [], skipped: [] };
beforeEach(() => { vi.clearAllMocks(); h.status.mockResolvedValue(idle); h.start.mockResolvedValue({ ...idle, phase: 'running' }); h.restart.mockResolvedValue({ ok: true }); });

afterEach(cleanup);

it.each([undefined, false, true])('persists plugin safe mode, off by default (%s)', async enabled => {
  const update = vi.fn();
  render(<DevelopmentView config={{ pluginSafeMode: enabled } as AppConfig} onUpdate={update} />);
  await waitFor(() => expect(h.status).toHaveBeenCalledOnce());
  const toggle = screen.getByRole('switch', { name: 'Plugin safe mode' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled ?? false));
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledExactlyOnceWith({ pluginSafeMode: !(enabled ?? false) });
  expect(screen.getByRole('heading', { name: 'Plugin recovery' }).closest('[data-settings-target]')?.getAttribute('data-settings-target'))
    .toBe('development.plugin-recovery');
});

it.each([undefined, false, true])('persists bundled plugin development, off by default (%s)', enabled => {
  const update = vi.fn();
  render(<DevelopmentView config={{ pluginDevelopmentEnabled: enabled } as AppConfig} onUpdate={update} />);
  const toggle = screen.getByRole('switch', { name: 'Bundled plugin development' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled ?? false));
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledExactlyOnceWith({ pluginDevelopmentEnabled: !(enabled ?? false) });
  expect(screen.getByText(/currently loaded plugins keep running/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Bundled plugins' }).closest('[data-settings-target]')?.getAttribute('data-settings-target'))
    .toBe('development.bundled-plugins');
});

it('requires confirmation and starts core recovery, then displays partial failures', async () => {
  render(<DevelopmentView config={{} as AppConfig} onUpdate={vi.fn()} />);
  await waitFor(() => expect(h.status).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Hard Plugin reload…' }));
  expect(h.start).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Fetch fresh plugin files?' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hard Plugin reload…' }));
  h.status.mockResolvedValue({ ...idle, phase: 'complete', total: 3, restored: ['provider-codex'], failed: [{ id: 'bad', message: 'offline' }], skipped: [{ id: 'local', message: 'No published source' }] });
  fireEvent.click(screen.getByRole('button', { name: 'Fetch and reload' }));
  await screen.findByText('Recovery complete: 1 restored, 1 failed, 1 skipped.');
  expect(h.start).toHaveBeenCalledOnce();
  expect(screen.getByText('bad: offline')).toBeTruthy();
  expect(screen.getByText('local: No published source')).toBeTruthy();
});

it.each([new Error('offline'), 'offline'])('reports recovery request failures: %s', async reason => {
  h.start.mockRejectedValue(reason);
  render(<DevelopmentView config={{} as AppConfig} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hard Plugin reload…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Fetch and reload' }));
  expect((await screen.findByRole('alert')).textContent).toBe('offline');
});

it('shows daemon restart progress and successful relaunch', async () => {
  let finish!: (value: { ok: true }) => void;
  h.restart.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<DevelopmentView config={{} as AppConfig} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restart host daemon' }));
  expect(screen.getByRole('button', { name: 'Restarting…' }).hasAttribute('disabled')).toBe(true);
  await act(async () => finish({ ok: true }));
  expect(screen.getByRole('status').textContent).toContain('Host daemon relaunched');
});

it.each([{ ok: false, message: 'restart failed' }, new Error('restart failed'), 'restart failed'])('reports daemon restart failure: %s', async reason => {
  if (typeof reason === 'object' && 'ok' in reason) h.restart.mockResolvedValue(reason); else h.restart.mockRejectedValue(reason);
  render(<DevelopmentView config={{} as AppConfig} onUpdate={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restart host daemon' }));
  expect((await screen.findByRole('alert')).textContent).toBe('restart failed');
});

it('polls running recovery and stops polling on unmount', async () => {
  vi.useFakeTimers();
  try {
    h.status.mockResolvedValue({ ...idle, phase: 'running', total: 1, current: 'tasks' });
    const view = render(<DevelopmentView config={{} as AppConfig} onUpdate={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByText('Restoring tasks… (0/1)')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restoring plugins…' }).hasAttribute('disabled')).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(750); });
    expect(h.status).toHaveBeenCalledTimes(2);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(h.status).toHaveBeenCalledTimes(2);
  } finally { vi.useRealTimers(); }
});

it('retries status after transport failure and ignores completion after unmount', async () => {
  vi.useFakeTimers();
  try {
    h.status.mockRejectedValueOnce('unavailable');
    const view = render(<DevelopmentView config={{} as AppConfig} onUpdate={vi.fn()} />);
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('unavailable');
    let resolve!: (state: typeof idle) => void;
    h.status.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    view.unmount();
    await act(async () => resolve(idle));
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
