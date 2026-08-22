import { describe, expect, it, vi } from 'vitest';
import { applySidebarWidth, SIDEBAR_MAX, SIDEBAR_MIN } from '../store.js';

describe('applySidebarWidth', () => {
  it('clamps to the current sidebar width as the minimum', () => {
    const setProperty = vi.fn();
    (globalThis as { document?: unknown }).document = {
      documentElement: { style: { setProperty } }
    };

    applySidebarWidth(180);
    expect(setProperty).toHaveBeenCalledWith('--col-nav', `${SIDEBAR_MIN}px`);

    applySidebarWidth(320);
    expect(setProperty).toHaveBeenCalledWith('--col-nav', '320px');

    applySidebarWidth(900);
    expect(setProperty).toHaveBeenCalledWith('--col-nav', `${SIDEBAR_MAX}px`);
  });
});
