// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrProjectControl } from './PrProjectControl.js';

afterEach(cleanup);
const projects = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];

it('focuses the assigned project and supports arrow keys, endpoints, and assignment', () => {
  const onAssign = vi.fn();
  render(<PrProjectControl projectId="b" projects={projects} onAssign={onAssign} />);
  const trigger = screen.getByRole('button', { name: /Associated with Beta/ });
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Beta' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Clear association' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Beta' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Clear association' }));
  fireEvent.keyDown(document.activeElement!, { key: 'End' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' }));
  expect(onAssign).toHaveBeenCalledWith('a');
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
});

it.each(['Escape', 'Tab'])('closes only the picker on %s and returns focus', (key) => {
  const parentKey = vi.fn();
  render(<div onKeyDown={parentKey}><PrProjectControl projects={projects} onAssign={vi.fn()} /></div>);
  const trigger = screen.getByRole('button');
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Alpha' }));
  fireEvent.keyDown(document.activeElement!, { key });
  expect(parentKey).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
});

it('keeps an empty picker keyboard reachable and dismisses its backdrop without bubbling', () => {
  const parentClick = vi.fn();
  render(<div onClick={parentClick}><PrProjectControl projects={[]} onAssign={vi.fn()} /></div>);
  const trigger = screen.getByRole('button');
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole('menu'));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  fireEvent.click(document.querySelector('.prm-project-menu-backdrop')!);
  expect(parentClick).not.toHaveBeenCalled();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
