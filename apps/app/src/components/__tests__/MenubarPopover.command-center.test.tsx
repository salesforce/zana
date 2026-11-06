// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  snapshot: {} as Record<string, unknown>,
  hide: vi.fn(),
  enter: vi.fn()
}));

vi.mock('../../lib/product-client.js', () => ({
  product: {
    menubar: {
      request: () => Promise.resolve(h.snapshot),
      onSnapshot: () => () => undefined,
      hide: (...a: unknown[]) => h.hide(...a),
      open: vi.fn(() => Promise.resolve()),
      quit: vi.fn(),
      focusAgent: vi.fn(),
      setFavorite: vi.fn()
    },
    companion: { enter: (...a: unknown[]) => h.enter(...a) }
  }
}));

import { MenubarPopover } from '../MenubarPopover.js';

const snap = (commandCenter: boolean) => ({
  agents: [],
  needsYou: 0,
  working: 0,
  scheduleCount: 0,
  nextRunAt: null,
  theme: 'dark',
  commandCenter
});

beforeEach(() => {
  h.hide.mockImplementation(() => Promise.reject(new Error('hide failed')));
  h.enter.mockImplementation(() => Promise.reject(new Error('enter failed')));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MenubarPopover Command Center entry', () => {
  it('shows the button and hides the popover then enters the rail on click (rejections swallowed)', async () => {
    h.snapshot = snap(true);
    render(<MenubarPopover />);
    const btn = await screen.findByText('Command Center');
    fireEvent.click(btn);
    expect(h.hide).toHaveBeenCalledTimes(1);
    expect(h.enter).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });

  it('omits the button when Command Center is off', async () => {
    h.snapshot = snap(false);
    render(<MenubarPopover />);
    await waitFor(() => expect(screen.getByText('All agents')).toBeTruthy());
    expect(screen.queryByText('Command Center')).toBeNull();
  });
});
