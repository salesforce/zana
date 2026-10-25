// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ desktop: true, quit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/product-client.js', () => ({ product: { menubar: { quit: h.quit } } }));
vi.mock('../lib/app-surface.js', () => ({ hasDesktopBridge: () => h.desktop }));
vi.mock('../views/settings/SharedInstancePicker.js', () => ({ SharedInstancePicker: ({ onOpened }: { onOpened(): void }) => <button onClick={onOpened}>Open fixture</button> }));
import { InstanceMenu } from './InstanceMenu.js';
function Route() { const location = useLocation(); return <output>{location.pathname}{location.hash}</output>; }
function view(path = '/') { return render(<MemoryRouter initialEntries={[path]}><InstanceMenu /><Route /></MemoryRouter>); }
beforeEach(() => { h.desktop = true; h.quit.mockClear(); }); afterEach(cleanup);
it('keeps desktop switching and quitting out of web clients', () => { h.desktop = false; view(); expect(screen.queryByText('This computer')).toBeNull(); });
it('opens a focused instance dialog and closes it after selection', async () => {
  const { container } = view();
  const menu = container.querySelector('details')!;
  menu.open = true;
  fireEvent.click(screen.getByRole('button', { name: 'Open another Zana…' }));
  expect(menu.open).toBe(false);
  expect(screen.getByRole('dialog', { name: 'Open another Zana' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Open fixture' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  menu.open = true; fireEvent.click(screen.getByRole('button', { name: 'Open another Zana…' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('names the current instance and closes on Escape, outside click or focus leaving', () => {
  const { container } = view();
  expect(screen.getByText('This computer', { selector: 'summary span' })).toBeTruthy();
  const menu = container.querySelector('details')!;
  menu.open = true; fireEvent.keyDown(menu, { key: 'Escape' }); expect(menu.open).toBe(false);
  menu.open = true; fireEvent.blur(menu, { relatedTarget: document.body }); expect(menu.open).toBe(false);
  menu.open = true; fireEvent.blur(menu, { relatedTarget: menu.querySelector('summary') }); expect(menu.open).toBe(true);
  fireEvent.pointerDown(menu.querySelector('summary')!); expect(menu.open).toBe(true);
  fireEvent.pointerDown(document.body); expect(menu.open).toBe(false);
});
it('quits the desktop through the existing authorized main action', () => {
  const { container } = view();
  const menu = container.querySelector('details')!; menu.open = true;
  fireEvent.click(screen.getByRole('button', { name: /Quit Zana/ }));
  expect(menu.open).toBe(false); expect(h.quit).toHaveBeenCalledOnce();
});
it('preserves the old shared-instance search destination and clears its handled hash', async () => {
  view('/settings/remote-access#remote-access.shared-instance');
  expect(await screen.findByRole('dialog', { name: 'Open another Zana' })).toBeTruthy();
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('/settings/remote-access'));
});
