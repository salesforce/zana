/** @vitest-environment happy-dom */
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HostFilterMenu } from './HostFilterMenu.js';
import { SyncFilterMenu } from './SyncFilterMenu.js';
import type { ModuleHost } from './host.js';

afterEach(cleanup);

it('keeps host filters inside the viewport, supports keyboard navigation and returns focus', () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  anchor.getBoundingClientRect = () => ({ left: -100, bottom: 2000, right: 0 } as DOMRect);
  const onClose = vi.fn();
  const onToggleHost = vi.fn();
  const onSelectAll = vi.fn();
  const { unmount } = render(<HostFilterMenu anchorRef={{ current: anchor }} hosts={['github.com', 'git.example.com']}
    selectedHosts={['github.com']} onClose={onClose} onToggleHost={onToggleHost} onSelectAll={onSelectAll} shortHost={(host) => host} />);
  const menu = screen.getByRole('menu', { name: 'Host filter' });
  const items = screen.getAllByRole('menuitemcheckbox');
  expect(menu.style.left).toBe('12px');
  expect(parseInt(menu.style.top)).toBeLessThan(window.innerHeight);
  expect(document.activeElement).toBe(items[0]);
  fireEvent.keyDown(window, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(items[1]);
  fireEvent.keyDown(window, { key: 'End' });
  expect(document.activeElement).toBe(items[2]);
  fireEvent.click(items[1]);
  expect(onToggleHost).toHaveBeenCalledWith('github.com');
  fireEvent.click(items[0]);
  expect(onSelectAll).toHaveBeenCalledOnce();
  fireEvent.keyDown(window, { key: 'Home' });
  fireEvent.keyDown(window, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(items[2]);
  fireEvent(window, new Event('resize'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledTimes(1);
  fireEvent.mouseDown(document.querySelector('.prm-project-menu-backdrop')!);
  expect(onClose).toHaveBeenCalledTimes(2);
  unmount();
  expect(document.activeElement).toBe(anchor);
  anchor.remove();
});

it('focuses sync filters, aligns the popover to the trigger, and closes on Tab', async () => {
  const anchor = document.createElement('button');
  document.body.append(anchor);
  anchor.getBoundingClientRect = () => ({ left: 200, right: 240, bottom: 80 } as DOMRect);
  const onClose = vi.fn();
  const { unmount } = render(<SyncFilterMenu anchorRef={{ current: anchor }}
    host={{ call: async () => ({ ok: true, repos: [] }) } as unknown as ModuleHost}
    selectedRepos={[]} onClose={onClose} onToggleRepo={vi.fn()} onSelectAll={vi.fn()} onSync={vi.fn()} />);
  expect(screen.getByRole('menu', { name: 'Sync & Filter' }).style.left).toBe('240px');
  expect(document.activeElement).toBe(screen.getByRole('menuitemcheckbox'));
  fireEvent.keyDown(window, { key: 'Tab' });
  expect(onClose).toHaveBeenCalledTimes(1);
  unmount();
  expect(document.activeElement).toBe(anchor);
  anchor.remove();
});
