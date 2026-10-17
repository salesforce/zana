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

it.each([false, true])('hydrates recovery and service-tier switches and persists changes from %s', enabled => {
  const update = vi.fn();
  render(<ExperimentalView config={{ ...base, pluginSafeMode: enabled, providerServiceTiersDisabled: enabled }}
    onConfigDraft={vi.fn()} onUpdate={update} />);
  for (const [label, key] of [
    ['Plugin safe mode', 'pluginSafeMode'],
    ['Disable non-default service tiers', 'providerServiceTiersDisabled']
  ] as const) {
    const toggle = screen.getByRole('switch', { name: label });
    expect(toggle.getAttribute('aria-checked')).toBe(String(enabled));
    fireEvent.click(toggle);
    expect(update).toHaveBeenCalledWith({ [key]: !enabled });
  }
});

it.each([false, true])('hydrates the Peers switch and persists the toggle from %s', enabled => {
  const update = vi.fn();
  render(<ExperimentalView config={{ ...base, peersSettingsEnabled: enabled }} onConfigDraft={vi.fn()} onUpdate={update} />);
  const toggle = screen.getByRole('switch', { name: 'Show Peers in Settings' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled));
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledWith({ peersSettingsEnabled: !enabled });
});

it('defaults the Peers switch to off when unset', () => {
  render(<ExperimentalView config={base} onConfigDraft={vi.fn()} onUpdate={vi.fn()} />);
  expect(screen.getByRole('switch', { name: 'Show Peers in Settings' }).getAttribute('aria-checked')).toBe('false');
});
