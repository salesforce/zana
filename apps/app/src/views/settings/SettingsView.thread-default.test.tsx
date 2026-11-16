// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useData, useUi } from '@/store';
import { SettingsView } from './SettingsView.js';

const h = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: vi.fn(async () => ({})), set: h.save, onChanged: () => () => {} },
  app: { homedir: vi.fn(async () => '/home/u') }, openers: { openIn: vi.fn() }
} }));
vi.mock('@/views/settings/HarnessView', () => ({ HarnessTab: ({ onUpdate }: { onUpdate: (patch: object) => Promise<void> }) => <>
  <button onClick={() => void onUpdate({ defaultThreadProviderId: 'requested' })}>Save thread default</button>
  <button onClick={() => void onUpdate({ defaultHarness: 'codex' })}>Save CLI default</button>
</> }));
beforeEach(() => {
  h.save.mockReset();
  useData.setState({ defaultThreadProviderId: 'original' });
  useUi.setState({ settingsTab: 'harness', settingsAnchor: null });
});
afterEach(cleanup);
const show = () => render(<MemoryRouter initialEntries={['/settings/harness']}><SettingsView /></MemoryRouter>);

it.each(['main-normalized', null, undefined])('mirrors the main-owned thread default %s after saving', async value => {
  h.save.mockResolvedValue({ defaultThreadProviderId: value });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Save thread default' }));
  await waitFor(() => expect(useData.getState().defaultThreadProviderId).toBe(value ?? null));
  expect(h.save).toHaveBeenCalledWith({ defaultThreadProviderId: 'requested' });
});
it('retains the thread default on a CLI edit or failed save', async () => {
  h.save.mockResolvedValueOnce({ defaultHarness: 'codex', defaultThreadProviderId: 'other' });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Save CLI default' }));
  await waitFor(() => expect(h.save).toHaveBeenCalledOnce());
  expect(useData.getState().defaultThreadProviderId).toBe('original');
  h.save.mockRejectedValueOnce(new Error('disk unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Save thread default' }));
  await waitFor(() => expect(h.save).toHaveBeenCalledTimes(2));
  expect(useData.getState().defaultThreadProviderId).toBe('original');
});
