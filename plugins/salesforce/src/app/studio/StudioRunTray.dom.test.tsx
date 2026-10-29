/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StudioRunTray } from './StudioRunTray.js';
import type { StudioRunDescriptor } from './run-workspaces.js';

afterEach(cleanup);
const run = (change: Partial<StudioRunDescriptor> = {}): StudioRunDescriptor => ({ pluginId: 'p', projectId: 'proj', path: 'bots/Support.agent', view: 'preview', key: 'a', runId: 'r', engine: 'simulate', status: 'active', turn: 2, updatedAt: 1, ...change });

it('shows only open sessions and returns to their original owner and tool', () => {
  const onOpen = vi.fn();
  const preview = run({ orgAlias: 'sandbox' });
  render(<StudioRunTray runs={[preview, run({ key: 'b', path: 'Orders.agent', view: 'roleplay', status: 'running' }), run({ key: 'c', status: 'expired' }), run({ key: 'd', status: 'ended' }), run({ key: 'e', path: undefined }), run({ key: 'f', view: 'org-preview' })]} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Active runs' }));
  expect(screen.getByText('3 active')).toBeTruthy();
  expect(screen.getByText('Role-play · Running · Turn 2')).toBeTruthy();
  expect(screen.getByText('Org preview · Session open · Turn 2')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Support.agent Preview/ }));
  expect(onOpen).toHaveBeenCalledWith(preview);
  expect(screen.queryByRole('region')).toBeNull();
});

it('dismisses with Escape or an outside click and restores keyboard focus', () => {
  render(<StudioRunTray runs={[run()]} onOpen={vi.fn()} />);
  const button = screen.getByRole('button', { name: 'Active runs' });
  fireEvent.click(button);
  fireEvent.keyDown(screen.getByRole('region'), { key: 'Escape' });
  expect(screen.queryByRole('region')).toBeNull();
  expect(document.activeElement).toBe(button);
  fireEvent.click(button);
  fireEvent.pointerDown(screen.getByRole('region'));
  expect(screen.getByRole('region')).toBeTruthy();
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('region')).toBeNull();
});

it('renders no empty control', () => {
  const { container } = render(<StudioRunTray runs={[]} onOpen={vi.fn()} />);
  expect(container.textContent).toBe('');
});
