// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { ExperimentalView } from './ExperimentalView.js';

afterEach(cleanup);
const base = {
  version: 1, theme: 'system', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13,
  lastProjectId: null, worktreeIsolationDefault: true
} as AppConfig;

it('keeps development controls on the dedicated Development page', () => {
  render(<ExperimentalView config={base} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />);
  expect(screen.queryByRole('switch', { name: 'Bundled plugin development' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Plugin recovery' })).toBeNull();
  expect(screen.queryByRole('switch', { name: 'Plugin safe mode' })).toBeNull();
});

it.each([false, true])('hydrates the service-tier switch and persists changes from %s', enabled => {
  const update = vi.fn();
  render(<ExperimentalView config={{ ...base, pluginSafeMode: enabled, providerServiceTiersDisabled: enabled }}
    onConfigDraft={vi.fn()} onUpdate={update} />);
  for (const [label, key] of [
    ['Disable non-default service tiers', 'providerServiceTiersDisabled']
  ] as const) {
    const toggle = screen.getByRole('switch', { name: label });
    expect(toggle.getAttribute('aria-checked')).toBe(String(enabled));
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ [key]: !enabled });
  }
});


it.each([undefined, true, false])('offers thread tabs, enabled by default: %s', enabled => {
  const update = vi.fn();
  render(<ExperimentalView config={{ ...base, threadTabsEnabled: enabled }} onConfigDraft={vi.fn()} onUpdate={update} />);
  const toggle = screen.getByRole('switch', { name: 'Thread tabs' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled ?? true));
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledWith({ threadTabsEnabled: !(enabled ?? true) });
  expect(screen.getByText(/Closing a tab keeps the thread running/)).toBeTruthy();
});

it.each([undefined, true, false])('offers dockable thread tools, enabled by default: %s', enabled => {
  const update = vi.fn();
  render(<ExperimentalView config={{ ...base, dockableThreadToolsEnabled: enabled }} onConfigDraft={vi.fn()} onUpdate={update} />);
  const toggle = screen.getByRole('switch', { name: 'Dockable thread tools' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled ?? true));
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledWith({ dockableThreadToolsEnabled: !(enabled ?? true) });
  expect(screen.getByText(/Moving a terminal keeps its session running/)).toBeTruthy();
});

it.each([undefined, true, false])('offers the inset workspace, disabled by default: %s', enabled => {
  const update = vi.fn();
  render(<ExperimentalView config={{ ...base, insetWorkspaceEnabled: enabled }} onConfigDraft={vi.fn()} onUpdate={update} />);
  const toggle = screen.getByRole('switch', { name: 'Inset workspace' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled ?? false));
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledWith({ insetWorkspaceEnabled: !(enabled ?? false) });
});
