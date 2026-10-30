// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
const repair = vi.hoisted(() => vi.fn());
vi.mock('../../lib/product-client.js', () => ({ product: { pluginApps: { repair } } }));
import { PluginSourceRecovery } from './PluginSourceRecovery';
const plugin = { id: 'example', sourceRecovery: { canLocate: true, canSwitchOfficial: true } } as PluginAppEntry;
afterEach(cleanup);
beforeEach(() => { repair.mockReset(); repair.mockResolvedValue({ ok: true, value: true }); });
it('locates the existing identity and reports success', async () => {
  render(<PluginSourceRecovery plugin={plugin} />);
  fireEvent.click(screen.getByRole('button', { name: 'Locate moved plugin…' }));
  expect((await screen.findByRole('status')).textContent).toContain('preserved');
  expect(repair).toHaveBeenCalledWith('example', 'locate');
});
it('confirms a distribution switch and supports cancel', async () => {
  render(<PluginSourceRecovery plugin={plugin} />);
  const open = () => fireEvent.click(screen.getByRole('button', { name: 'Switch to official distribution…' }));
  open(); expect(repair).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('group')).toBeNull();
  open(); fireEvent.click(screen.getByRole('button', { name: 'Switch distribution' }));
  await screen.findByRole('status'); expect(repair).toHaveBeenCalledWith('example', 'official');
});
it.each([{ ok: false, code: 'CANCELED' }, { ok: false, message: 'Different identity' }, new Error('Offline'), 'Failed'])('handles canceled and failed recovery: %s', async outcome => {
  if (outcome instanceof Error || typeof outcome === 'string') repair.mockRejectedValue(outcome);
  else repair.mockResolvedValue(outcome);
  render(<PluginSourceRecovery plugin={plugin} />);
  fireEvent.click(screen.getByRole('button', { name: 'Locate moved plugin…' }));
  if (typeof outcome === 'object' && 'code' in outcome && outcome.code === 'CANCELED') {
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Locate moved plugin…' }).hasAttribute('disabled')).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  } else await screen.findByRole('alert');
});
it('shows only the host-authorized choices', () => {
  const view = render(<PluginSourceRecovery plugin={{ ...plugin, sourceRecovery: { canLocate: true, canSwitchOfficial: false } }} />);
  expect(screen.queryByRole('button', { name: /official/ })).toBeNull();
  view.rerender(<PluginSourceRecovery plugin={{ ...plugin, sourceRecovery: { canLocate: false, canSwitchOfficial: true } }} />);
  expect(screen.queryByRole('button', { name: /Locate/ })).toBeNull();
});
