// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MachineProjectAddMenu } from './MachineProjectAddMenu.js';
afterEach(cleanup);
it('portals a scoped dropdown, skips disabled actions, navigates by keyboard, and returns focus on Escape', () => {
  const run = vi.fn();
  render(
    <MachineProjectAddMenu
      name="Devbox"
      actions={[
        { id: 'open', label: 'Add folder', icon: null, run },
        { id: 'create', label: 'New folder', disabled: true, icon: null, run },
        { id: 'clone', label: 'Clone from Git', icon: null, run }
      ]}
    />
  );
  const trigger = screen.getByRole('button', { name: 'Add project on Devbox' });
  fireEvent.click(trigger);
  const menu = screen.getByRole('menu', { name: 'Add project on Devbox' });
  expect(menu.parentElement).toBe(document.body);
  expect(document.activeElement).toBe(
    screen.getByRole('menuitem', { name: 'Add folder' })
  );
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(
    screen.getByRole('menuitem', { name: 'Clone from Git' })
  );
  for (const key of ['Home', 'End', 'ArrowUp'])
    fireEvent.keyDown(document.activeElement!, { key });
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem', { name: 'Clone from Git' }));
  expect(run).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});
it('dismisses on outside pointer, relevant scroll, resize and Tab; keeps unrelated scrolls', () => {
  render(<MachineProjectAddMenu name="Mac" note="Offline" actions={[]} />);
  const trigger = screen.getByRole('button');
  fireEvent.click(trigger);
  expect(screen.getByText('Offline')).toBeTruthy();
  fireEvent.scroll(document.createElement('div'));
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.pointerDown(trigger);
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.scroll(document);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  fireEvent(window, new Event('resize'));
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' });
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(screen.queryByRole('menu')).toBeNull();
});
