// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelRefreshControl } from './ModelRefreshControl.js';
import { reloadThreadModelCatalog } from '../../components/thread/pickers/thread-model-catalog.js';
import { refreshModelsWithToast } from '../../components/thread/pickers/model-refresh.js';

vi.mock('../../components/thread/pickers/thread-model-catalog.js', () => ({ reloadThreadModelCatalog: vi.fn() }));
afterEach(cleanup);

it('shares Settings progress with palette recovery, reports failures, and supports retry', async () => {
  let release!: (value: { failedCatalogs: number; failedProviders: string[] }) => void;
  vi.mocked(reloadThreadModelCatalog).mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
  render(<ModelRefreshControl />);
  expect(screen.getByRole('status').textContent).toContain('Refresh model choices for Modern and CLI Agent sessions');
  fireEvent.click(screen.getByRole('button', { name: 'Recalculate models' }));
  expect((screen.getByRole('button', { name: 'Recalculating models…' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => release({ failedCatalogs: 0, failedProviders: ['Pi'] }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('Could not refresh: Pi'));
  vi.mocked(reloadThreadModelCatalog).mockResolvedValueOnce({ failedCatalogs: 0, failedProviders: [] });
  await act(async () => { await refreshModelsWithToast(vi.fn()); });
  expect(screen.getByRole('status').textContent).toBe('Model lists refreshed.');
  expect((screen.getByRole('button', { name: 'Recalculate models' }) as HTMLButtonElement).disabled).toBe(false);
});
