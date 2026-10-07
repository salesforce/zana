// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelReasoningPicker, type ModelReasoningPickerProps } from './ModelReasoningPicker.js';

const props: ModelReasoningPickerProps = {
  providerOptions: [{ value: 'codex', label: 'Codex' }], selectedProviderId: 'codex',
  modelValue: 'existing', modelOptions: [{ value: 'existing', label: 'Existing model' }],
  onModelChange: vi.fn()
};
const open = () => fireEvent.click(screen.getByTestId('model-reasoning-picker-trigger'));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('offers reload only inside the open picker and keeps cached models usable while refreshing', async () => {
  let finish!: () => void;
  const reload = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<ModelReasoningPicker {...props} onReloadModels={reload} />);
  expect(screen.queryByRole('button', { name: 'Reload models' })).toBeNull();
  open();
  const button = screen.getByRole('button', { name: 'Reload models' }) as HTMLButtonElement;
  expect(button.closest('.model-reasoning-picker-section-label')?.textContent).toBe('Model');
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Reloading models' })).toBe(button);
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  fireEvent.click(button);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(screen.getByTestId('model-reasoning-model-existing').getAttribute('class')).toContain('is-selected');
  expect(props.onModelChange).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(screen.getByRole('button', { name: 'Reload models' })).toBe(button);
  expect(button.disabled).toBe(false);
  fireEvent.click(screen.getByTestId('model-reasoning-model-existing'));
  expect(props.onModelChange).toHaveBeenCalledWith('existing');
});

it('shows a failed reload, retains the list, and clears the failure on retry', async () => {
  const reload = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  render(<ModelReasoningPicker {...props} onReloadModels={reload} />);
  open();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload models' })); });
  expect(screen.getByRole('status').textContent).toBe('Could not reload models. Try again.');
  expect(screen.getByTestId('model-reasoning-model-existing')).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload models' })); });
  expect(reload).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('status')).toBeNull();
});

it('hides reload for a pinned native-role model or an absent callback and disables it during initial loading', () => {
  const reload = vi.fn();
  const view = render(<ModelReasoningPicker {...props} />);
  open();
  expect(screen.queryByRole('button', { name: 'Reload models' })).toBeNull();
  view.rerender(<ModelReasoningPicker {...props} onReloadModels={reload} modelLockedLabel="Model chosen by Reviewer" />);
  expect(screen.queryByRole('button', { name: 'Reload models' })).toBeNull();
  view.rerender(<ModelReasoningPicker {...props} onReloadModels={reload} modelIsLoading />);
  const button = screen.getByRole('button', { name: 'Reload models' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(reload).not.toHaveBeenCalled();
});

it('does not carry pending or failed reload state across a harness switch', async () => {
  let reject!: (error: Error) => void;
  const reload = vi.fn(() => new Promise<void>((_resolve, failure) => { reject = failure; }));
  const view = render(<ModelReasoningPicker {...props} onReloadModels={reload} />);
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Reload models' }));
  view.rerender(<ModelReasoningPicker {...props} selectedProviderId="claude-code" onReloadModels={() => undefined} />);
  expect((screen.getByRole('button', { name: 'Reload models' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => { reject(new Error('old harness offline')); });
  expect(screen.queryByRole('status')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Reload models' })); });
  expect(screen.getByRole('button', { name: 'Reload models' })).toBeTruthy();
});
