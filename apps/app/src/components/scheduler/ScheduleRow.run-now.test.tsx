/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

const runNow = vi.hoisted(() => vi.fn());
const pushToast = vi.hoisted(() => vi.fn());

vi.mock('../../lib/product-client.js', () => ({
  product: { scheduler: { setEnabled: vi.fn(), runNow: (...a: unknown[]) => runNow(...a) }, terminals: { close: vi.fn() } }
}));
vi.mock('../../store.js', () => ({
  useData: (selector: (s: { terminals: Record<string, never> }) => unknown) => selector({ terminals: {} }),
  useUi: Object.assign(
    (selector: (s: { pushToast: typeof pushToast }) => unknown) => selector({ pushToast }),
    { getState: () => ({ pushToast }) }
  )
}));

import { ScheduleRow } from './ScheduleRow.js';

const task = (runs: Array<Record<string, unknown>> = []) => ({
  id: 's1', name: 'Nightly', enabled: true, projectId: 'p1', profile: 'claude', schedule: { every: '1h' },
  overlap: 'skip', history: { retain: 10 }, status: { runCount: 0, runs },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z'
}) as unknown as ScheduledTask;

const mount = () => render(
  <MemoryRouter>
    <ScheduleRow task={task()} projectName="Demo" onOpen={vi.fn()} onOpenInSplit={vi.fn()} onDuplicate={vi.fn()} onAskDelete={vi.fn()} />
  </MemoryRouter>
);

afterEach(() => { cleanup(); runNow.mockReset(); pushToast.mockReset(); });

describe('ScheduleRow run now outcome', () => {
  it('toasts the transport failure', async () => {
    runNow.mockResolvedValue({ ok: false, message: 'denied' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Run failed: denied', 'error'));
  });

  it('toasts the recorded cause when the launch was refused', async () => {
    runNow.mockResolvedValue({ ok: true, value: task([{ at: 'x', result: 'error', message: 'Squad requirements are unavailable' }]) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Run failed: Squad requirements are unavailable', 'error'));
    expect(pushToast).not.toHaveBeenCalledWith('Fired "Nightly"', 'info');
  });

  it('toasts fired when the newest run did not fail', async () => {
    runNow.mockResolvedValue({ ok: true, value: task([{ at: 'x', result: 'success' }]) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await vi.waitFor(() => expect(pushToast).toHaveBeenCalledWith('Fired "Nightly"', 'info'));
  });
});
