// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileProjectPicker } from './MobileProjectPicker.js';

afterEach(cleanup);
const options = [
  { value: 'one', label: 'First project' },
  { value: 'remote', label: 'Remote project', description: 'Remote · dev@example', content: <span>Remote project</span> },
  { value: 'disabled', label: 'Unavailable project', disabled: true },
  { value: 'new', label: 'New project', sticky: true }
];

it('opens without focusing search, filters descriptions, and selects a project with focus restored', () => {
  const onChange = vi.fn();
  render(<MobileProjectPicker ariaLabel="Project" value="one" options={options} onChange={onChange} className="composer-location-picker" />);
  const trigger = screen.getByRole('button', { name: 'Project', exact: true });
  expect(trigger.classList.contains('composer-location-picker')).toBe(true);
  fireEvent.pointerDown(trigger, { button: 2 });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(fireEvent.pointerDown(trigger, { button: 0 })).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close project picker' }));
  expect(screen.getByRole('button', { name: 'First project' }).getAttribute('aria-pressed')).toBe('true');
  expect((screen.getByRole('button', { name: 'Unavailable project' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'dev@example' } });
  expect(screen.queryByRole('button', { name: 'First project' })).toBeNull();
  expect(screen.getByRole('button', { name: 'New project' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Remote project/ }));
  expect(onChange).toHaveBeenCalledWith('remote');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
});

it('keeps actions available for an empty search and closes through the button, Escape, and backdrop', () => {
  const onChange = vi.fn();
  render(<MobileProjectPicker ariaLabel="Project" value="" options={options} placeholder="Choose" emptyHint="No matching projects" onChange={onChange} />);
  const trigger = screen.getByRole('button', { name: 'Project', exact: true });
  expect(trigger.textContent).toBe('Choose');
  fireEvent.click(trigger);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'no-match' } });
  expect(screen.getByRole('status').textContent).toBe('No matching projects');
  fireEvent.click(screen.getByRole('button', { name: 'New project' }));
  expect(onChange).toHaveBeenCalledWith('new');
  for (const close of [
    () => fireEvent.click(screen.getByRole('button', { name: 'Close project picker' })),
    () => fireEvent.keyDown(document.activeElement!, { key: 'Escape' }),
    () => fireEvent.mouseDown(screen.getByRole('dialog').parentElement!)
  ]) {
    fireEvent.click(trigger);
    close();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  }
});

it('supports an empty list without actions and a disabled trigger', () => {
  const props = { ariaLabel: 'Project', value: '', options: [], onChange: vi.fn() };
  const { rerender } = render(<MobileProjectPicker {...props} disabled triggerIcon={<span>Icon</span>} title="Pick a project" />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.queryByRole('dialog')).toBeNull();
  rerender(<MobileProjectPicker {...props} />);
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByRole('dialog').querySelector('.modal-footer')).toBeNull();
});
