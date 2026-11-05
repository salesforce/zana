/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const reload = vi.hoisted(() => vi.fn());
vi.mock('./plugin-app-loader.js', () => ({ reloadPluginApp: reload }));
import { PluginLoadFailure } from './PluginLoadFailure.js';

afterEach(() => { cleanup(); reload.mockReset(); });

it('shows the plugin name, raw diagnostic, and a reload action', () => {
  render(<PluginLoadFailure pluginId="dashboard" name="Team dashboard" detail="Missing module <source>" />);
  expect(screen.getByRole('heading', { name: 'Team dashboard couldn’t load' })).toBeTruthy();
  expect(screen.getByText('Missing module <source>')).toBeTruthy();
  expect(screen.getByText('Technical details').closest('details')?.open).toBe(false);
});

it('serializes reload clicks and restores the action after completion', async () => {
  let finish!: () => void;
  reload.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<PluginLoadFailure pluginId="dashboard" detail="UI failed" />);
  fireEvent.click(screen.getByRole('button', { name: 'Reload plugin' }));
  const button = screen.getByRole('button', { name: 'Reloading…' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(reload).toHaveBeenCalledExactlyOnceWith('dashboard');
  finish();
  await waitFor(() => expect((screen.getByRole('button', { name: 'Reload plugin' }) as HTMLButtonElement).disabled).toBe(false));
});

it.each([new Error('Source still broken'), 'Server offline'])('keeps failures visible and allows another attempt: %s', async failure => {
  reload.mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
  render(<PluginLoadFailure pluginId="dashboard" detail="Original failure" />);
  fireEvent.click(screen.getByRole('button', { name: 'Reload plugin' }));
  const message = failure instanceof Error ? failure.message : failure;
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(message));
  fireEvent.click(screen.getByRole('button', { name: 'Reload plugin' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(''));
  expect(reload).toHaveBeenCalledTimes(2);
});
