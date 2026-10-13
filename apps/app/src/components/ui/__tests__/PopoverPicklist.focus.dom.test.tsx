// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PopoverPicklist } from '../PopoverPicklist.js';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const options = [
  { value: 'alpha', label: 'alpha' },
  { value: 'beta', label: 'beta' }
];

// jsdom does not ignore focus() on hidden elements the way browsers do, so
// record whether the menu was still unplaced when focus was requested.
function trackFocus() {
  const calls: { element: HTMLElement; menuHidden: boolean }[] = [];
  const original = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, opts?: FocusOptions) {
    const menu = this.closest<HTMLElement>('[role="listbox"]');
    calls.push({ element: this, menuHidden: menu?.style.visibility === 'hidden' });
    original.call(this, opts);
  });
  return calls;
}

it('focuses the search input once the menu is placed, so typing filters immediately', () => {
  const calls = trackFocus();
  render(<PopoverPicklist ariaLabel="Project" value="beta" options={options} onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Project' }));

  const search = screen.getByRole('textbox', { name: 'Search…' });
  expect(document.activeElement).toBe(search);
  expect(calls.filter((call) => call.element === search).every((call) => !call.menuHidden)).toBe(true);
});

it('focuses the listbox when the picklist is not searchable', () => {
  render(<PopoverPicklist ariaLabel="Mode" value="alpha" options={options} onChange={vi.fn()} searchable={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Mode' }));
  expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Mode' }));
});

it('refocuses the search input on reopen and returns focus to the trigger on close', () => {
  render(<PopoverPicklist ariaLabel="Project" value="beta" options={options} onChange={vi.fn()} />);
  const trigger = screen.getByRole('button', { name: 'Project' });
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search…' }), { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search…' }));
});
