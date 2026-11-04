// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginDetailPage } from './PluginDetailPage.js';

afterEach(cleanup);
it('opens a full-page landmark, focuses Back, and restores the collection opener on return', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const onBack = vi.fn();
  const view = render(<PluginDetailPage label="Installed plugin" onBack={onBack}><button>Plugin action</button></PluginDetailPage>);
  expect(screen.getByRole('region', { name: 'Installed plugin' })).toBeTruthy();
  expect(screen.queryByRole('separator')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Back to Plugins' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Plugin action' }), { key: 'Escape' });
  expect(onBack).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to Plugins' }));
  expect(onBack).toHaveBeenCalledOnce();
  view.unmount(); expect(document.activeElement).toBe(opener); opener.remove();
});
it('does not try to focus a collection opener that was removed', () => {
  const opener = document.createElement('button'); document.body.append(opener); opener.focus();
  const focus = vi.spyOn(opener, 'focus');
  const view = render(<PluginDetailPage label="Marketplace plugin" onBack={vi.fn()}>Plugin details</PluginDetailPage>);
  opener.remove(); view.unmount(); expect(focus).not.toHaveBeenCalled();
});
