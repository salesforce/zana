// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EXPLORER_MINIMAP_DEFAULTS } from '@zana-ai/zcc-domain/product';

const set = vi.hoisted(() => vi.fn());
vi.mock('../../lib/product-client.js', () => ({ product: {
  config: { get: vi.fn(async () => ({})), set, onChanged: () => () => {} },
  app: { homedir: vi.fn(async () => '/home/u') },
  openers: { openIn: vi.fn(async () => undefined) }
} }));
vi.mock('@/components/ui/PopoverPicklist', () => ({
  PopoverPicklist: (props: any) => (
    <select
      aria-label={props.ariaLabel}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    >
      {props.options?.map((opt: any) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  ),
}));
import { useData, useUi } from '@/store';
import { SettingsView } from './SettingsView';

beforeEach(() => {
  set.mockReset();
  set.mockImplementation(async (patch: object) => patch);
  useData.setState({ explorerMinimap: EXPLORER_MINIMAP_DEFAULTS, explorerFileIconTheme: 'seti' });
  useUi.setState({ settingsTab: 'editor', settingsAnchor: null });
});
afterEach(cleanup);

it('mirrors an Explorer minimap change made in Settings into the store', async () => {
  render(<MemoryRouter initialEntries={['/settings']}><SettingsView /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('switch', { name: 'Minimap' }));
  await waitFor(() => expect(useData.getState().explorerMinimap.enabled).toBe(false));
  expect(set).toHaveBeenCalledWith({ explorerMinimapEnabled: false });
});

it('mirrors an Explorer file icon theme change made in Settings into the store', async () => {
  render(<MemoryRouter initialEntries={['/settings']}><SettingsView /></MemoryRouter>);
  fireEvent.change(await screen.findByLabelText('File icon theme'), { target: { value: 'none' } });
  await waitFor(() => expect(useData.getState().explorerFileIconTheme).toBe('none'));
  expect(set).toHaveBeenCalledWith({ explorerFileIconTheme: 'none' });
});
