// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginInspector } from './PluginInspector.js';
afterEach(cleanup);
it('focuses the inspector, closes with Escape or the close control, and restores focus', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const close = vi.fn();
  const view = render(<PluginInspector label="Installed plugin" onClose={close}><button>Action</button></PluginInspector>);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close plugin details' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Action' }), { key: 'Enter' });
  expect(close).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Action' }), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Close plugin details' }));
  expect(close).toHaveBeenCalledTimes(2);
  view.unmount(); expect(document.activeElement).toBe(opener); opener.remove();
});
it('lets a nested dialog handle Escape and tolerates a removed opener', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const close = vi.fn();
  const view = render(<PluginInspector label="Marketplace plugin" onClose={close}><div role="dialog"><button>Confirm</button></div></PluginInspector>);
  opener.remove();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Confirm' }), { key: 'Escape' });
  expect(close).not.toHaveBeenCalled(); view.unmount();
});
