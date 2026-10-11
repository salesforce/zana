// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnNotificationLevel, ThreadNotificationState } from '@zana-ai/zcc-domain';

const { notificationLevel, setNotificationLevel, pushToast } = vi.hoisted(() => ({
  notificationLevel: vi.fn(),
  setNotificationLevel: vi.fn(),
  pushToast: vi.fn()
}));
vi.mock('../../lib/product-client.js', () => ({
  product: { threads: { notificationLevel, setNotificationLevel } }
}));
vi.mock('../../store.js', () => ({
  errorMessage: (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback),
  useUi: { getState: () => ({ pushToast }) }
}));

import { ThreadNotificationLevelControl } from './ThreadNotificationLevel.js';

const state = (overrides: Partial<ThreadNotificationState> = {}): ThreadNotificationState => ({
  threadId: 'thr_1',
  own: 'inherit',
  effective: 'all',
  source: 'global',
  defaultLevel: 'all',
  childLevel: 'input-only',
  ...overrides
});

beforeEach(() => {
  notificationLevel.mockReset();
  setNotificationLevel.mockReset();
  pushToast.mockReset();
});
afterEach(cleanup);

async function open() {
  fireEvent.click(await screen.findByRole('button', { name: /^Notifications/ }));
}
const radio = (name: string) => screen.getByRole('menuitemradio', { name });

describe('ThreadNotificationLevelControl', () => {
  it('loads the thread level when it appears and summarises the effective level', async () => {
    notificationLevel.mockResolvedValue(state({ own: 'inherit', effective: 'input-only', source: 'child-default' }));
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    expect(notificationLevel).toHaveBeenCalledWith('thr_1');
    const trigger = await screen.findByRole('button', { name: 'Notifications: Needs input only' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });

  it('offers the four levels with the thread own level checked and explains where the level comes from', async () => {
    notificationLevel.mockResolvedValue(state({ own: 'inherit', effective: 'input-only', source: 'child-default' }));
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    await open();
    expect(screen.getAllByRole('menuitemradio').map((el) => el.textContent)).toEqual([
      'Default',
      'All activity',
      'Needs input only',
      'Muted'
    ]);
    expect(radio('Default').getAttribute('aria-checked')).toBe('true');
    expect(radio('Muted').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText(/child-thread default/i)).toBeTruthy();
  });

  it('saves the chosen level and refreshes from the server answer, including an ancestor cap', async () => {
    notificationLevel.mockResolvedValue(state());
    setNotificationLevel.mockImplementation(async (_id: string, level: OwnNotificationLevel) =>
      state({ own: level, effective: 'muted', source: 'parent' })
    );
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    await open();
    fireEvent.click(radio('All activity'));
    await waitFor(() => expect(setNotificationLevel).toHaveBeenCalledWith('thr_1', 'all'));
    // The server says the parent still mutes this thread: the menu shows that, not the click.
    await screen.findByRole('button', { name: 'Notifications: Muted' });
    expect(radio('All activity').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/limited by the parent thread/i)).toBeTruthy();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('ignores a second click while a save is in flight', async () => {
    notificationLevel.mockResolvedValue(state());
    let finish!: (value: ThreadNotificationState) => void;
    setNotificationLevel.mockReturnValue(new Promise<ThreadNotificationState>((resolve) => (finish = resolve)));
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    await open();
    fireEvent.click(radio('Muted'));
    fireEvent.click(radio('All activity'));
    expect(setNotificationLevel).toHaveBeenCalledTimes(1);
    expect((radio('Muted') as HTMLButtonElement).disabled).toBe(true);
    finish(state({ own: 'muted', effective: 'muted', source: 'self' }));
    await screen.findByRole('button', { name: 'Notifications: Muted' });
    expect((radio('Muted') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps the previous level and reports the failure when saving fails', async () => {
    notificationLevel.mockResolvedValue(state({ own: 'all' }));
    setNotificationLevel.mockRejectedValue(new Error('at most 2000 threads can have their own notification level'));
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    await open();
    fireEvent.click(radio('Muted'));
    await waitFor(() =>
      expect(pushToast).toHaveBeenCalledWith('at most 2000 threads can have their own notification level', 'error')
    );
    expect(radio('All activity').getAttribute('aria-checked')).toBe('true');
    expect(radio('Muted').getAttribute('aria-checked')).toBe('false');
    expect((radio('Muted') as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows an unavailable, disabled control when the level cannot be loaded', async () => {
    notificationLevel.mockRejectedValue(new Error('offline'));
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    const trigger = await screen.findByRole('button', { name: 'Notifications: Unavailable' });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    expect(setNotificationLevel).not.toHaveBeenCalled();
  });

  it('is disabled while the level loads', () => {
    notificationLevel.mockReturnValue(new Promise(() => undefined));
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    const trigger = screen.getByRole('button', { name: 'Notifications' }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
  });

  it('reloads for another thread and drops a late answer for the previous one', async () => {
    let answerFirst!: (value: ThreadNotificationState) => void;
    notificationLevel.mockImplementation((id: string) =>
      id === 'thr_1'
        ? new Promise<ThreadNotificationState>((resolve) => (answerFirst = resolve))
        : Promise.resolve(state({ threadId: 'thr_2', own: 'muted', effective: 'muted', source: 'self' }))
    );
    const view = render(<ThreadNotificationLevelControl threadId="thr_1" />);
    view.rerender(<ThreadNotificationLevelControl threadId="thr_2" />);
    await screen.findByRole('button', { name: 'Notifications: Muted' });
    answerFirst(state({ threadId: 'thr_1', effective: 'all' }));
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Notifications: Muted' })).toBeTruthy();
  });

  it('collapses the levels again', async () => {
    notificationLevel.mockResolvedValue(state());
    render(<ThreadNotificationLevelControl threadId="thr_1" />);
    await open();
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^Notifications/ }));
    expect(screen.queryByRole('menuitemradio')).toBeNull();
  });
});
