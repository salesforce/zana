// @vitest-environment happy-dom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThreadDetailSearch } from './ThreadDetailSearch.js';

afterEach(cleanup);

it('focuses search, submits the query and clears it with the mobile close action', () => {
  const submit = vi.fn();
  function Fixture() {
    const [value, setValue] = useState('');
    return <ThreadDetailSearch mobileHeader value={value} onChange={setValue} onSubmit={submit} />;
  }
  render(<Fixture />);
  const input = screen.getByRole('searchbox') as HTMLInputElement;
  const toggle = screen.getByRole('button', { name: 'Search in thread' });
  expect(fireEvent.pointerDown(toggle)).toBe(false);
  fireEvent.click(toggle);
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: '  mobile  ' } });
  fireEvent.submit(input.closest('form')!);
  expect(submit).toHaveBeenLastCalledWith('mobile');
  const close = screen.getByRole('button', { name: 'Close search' });
  close.focus();
  fireEvent.click(close);
  expect(input.value).toBe('');
  expect(submit).toHaveBeenLastCalledWith('');
  expect(input.closest('form')!.classList.contains('has-query')).toBe(false);
  expect(document.activeElement).not.toBe(close);
  expect(document.activeElement).not.toBe(input);
});

it('retains Escape behavior and leaves desktop without the extra close control', () => {
  const change = vi.fn();
  const submit = vi.fn();
  render(<ThreadDetailSearch value="query" onChange={change} onSubmit={submit} />);
  expect(fireEvent.pointerDown(screen.getByRole('button', { name: 'Search in thread' }))).toBe(true);
  expect(screen.queryByRole('button', { name: 'Close search' })).toBeNull();
  const input = screen.getByRole('searchbox');
  input.focus();
  fireEvent.keyDown(input, { key: 'ArrowLeft' });
  expect(change).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(change).toHaveBeenCalledWith('');
  expect(submit).toHaveBeenCalledWith('');
  expect(document.activeElement).not.toBe(input);
});


it('focuses the search opened from More and returns control to its owner on dismissal', () => {
  const close = vi.fn();
  const { rerender } = render(<ThreadDetailSearch mobileHeader autoFocus value="" onChange={() => {}} onSubmit={() => {}} onClose={close} />);
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Close search' }));
  expect(close).toHaveBeenCalledOnce();
  rerender(<ThreadDetailSearch mobileHeader autoFocus value="find" onChange={() => {}} onSubmit={() => {}} onClose={close} />);
  fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(2);
});

it('focuses and selects the field on each find request and shows the shortcut', () => {
  Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
  const { rerender } = render(<ThreadDetailSearch value="earlier" onChange={() => {}} onSubmit={() => {}} />);
  const input = screen.getByRole('searchbox') as HTMLInputElement;
  expect(document.activeElement).not.toBe(input);
  expect(screen.getByRole('button', { name: 'Search in thread' }).getAttribute('title')).toBe('Search in thread (Ctrl + F)');
  rerender(<ThreadDetailSearch value="earlier" focusRequest={1} onChange={() => {}} onSubmit={() => {}} />);
  expect(document.activeElement).toBe(input);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, 7]);
  input.blur();
  rerender(<ThreadDetailSearch value="earlier" focusRequest={2} onChange={() => {}} onSubmit={() => {}} />);
  expect(document.activeElement).toBe(input);
});
