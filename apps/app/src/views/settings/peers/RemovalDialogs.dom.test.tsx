// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveUseConfirm, HookFailureDialog, RemovePluginsConfirm, activeUseText, hookFailureText } from './RemovalDialogs';

afterEach(cleanup);

describe('helpers', () => {
  it('activeUseText names one or many plugins', () => {
    expect(activeUseText(['A'], 'Mac')).toBe('A is transferring with Mac. Stop anyway?');
    expect(activeUseText(['A', 'B'], 'Mac')).toBe('A is transferring with Mac. B is transferring with Mac. Stop anyway?');
  });
  it('hookFailureText maps reasons', () => {
    expect(hookFailureText([{ label: 'A', reason: 'timeout' }, { label: 'B', reason: 'error' }]))
      .toBe("A didn't finish cleaning up (timed out). B didn't finish cleaning up (failed).");
  });
});

describe('components', () => {
  it('ActiveUseConfirm', () => {
    const onStop = vi.fn(); const onCancel = vi.fn();
    render(<ActiveUseConfirm active={[{ label: 'A' }]} host="Mac" onStop={onStop} onCancel={onCancel} />);
    expect(screen.getByRole('alertdialog', { name: 'Active transfer with Mac' })).toBeTruthy();
    expect(screen.getByText('A is transferring with Mac. Stop anyway?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep syncing' }));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('RemovePluginsConfirm and busy disables confirm', () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    const { rerender } = render(<RemovePluginsConfirm text="Sure?" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<RemovePluginsConfirm text="Sure?" onConfirm={onConfirm} onCancel={onCancel} busy />);
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('HookFailureDialog', () => {
    const onRetry = vi.fn(); const onRemoveAnyway = vi.fn(); const onCancel = vi.fn();
    render(<HookFailureDialog failures={[{ pluginId: 'a', label: 'A', reason: 'timeout' }]} onRetry={onRetry} onRemoveAnyway={onRemoveAnyway} onCancel={onCancel} />);
    expect(screen.getByText("A didn't finish cleaning up (timed out).")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRemoveAnyway).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
