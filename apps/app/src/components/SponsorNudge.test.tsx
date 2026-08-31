/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GITHUB_REPO_URL } from '@zana-ai/zcc-domain/product';

const getConfig = vi.fn();
const setConfig = vi.fn((_patch: unknown) => Promise.resolve());
const scoped = vi.fn(() => false);

vi.mock('../lib/product-client.js', () => ({
  product: {
    config: {
      get: () => getConfig(),
      set: (patch: unknown) => setConfig(patch)
    }
  }
}));

vi.mock('../lib/windowScope.js', () => ({
  isScopedWindow: () => scoped()
}));

import { SponsorNudge } from './SponsorNudge.js';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  scoped.mockReturnValue(false);
  getConfig.mockResolvedValue({ sponsorPromptDismissed: false });
  setConfig.mockResolvedValue(undefined);
});

describe('SponsorNudge', () => {
  it('stays hidden until config confirms the prompt is still open', () => {
    getConfig.mockReturnValue(new Promise(() => {}));
    const { container } = render(<SponsorNudge />);
    expect(container.querySelector('.sponsor-nudge')).toBeNull();
  });

  it('shows the star prompt when sponsorPromptDismissed is absent or false', async () => {
    render(<SponsorNudge />);
    expect(await screen.findByRole('dialog', { name: 'Support Zana' })).toBeTruthy();
    expect(screen.getByText('Enjoying Zana?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Star on GitHub' })).toBeTruthy();
  });

  it('does not show when the prompt was already dismissed', async () => {
    getConfig.mockResolvedValue({ sponsorPromptDismissed: true });
    render(<SponsorNudge />);
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Support Zana' })).toBeNull();
  });

  it('stays hidden when config cannot be read', async () => {
    getConfig.mockRejectedValue(new Error('offline'));
    render(<SponsorNudge />);
    await vi.waitFor(() => expect(getConfig).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Support Zana' })).toBeNull();
  });

  it('never fetches or renders in a scoped project window', async () => {
    scoped.mockReturnValue(true);
    render(<SponsorNudge />);
    await Promise.resolve();
    expect(getConfig).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Support Zana' })).toBeNull();
  });

  it('persists dismiss and hides the card', async () => {
    render(<SponsorNudge />);
    await screen.findByRole('dialog', { name: 'Support Zana' });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(setConfig).toHaveBeenCalledWith({ sponsorPromptDismissed: true });
    expect(screen.queryByRole('dialog', { name: 'Support Zana' })).toBeNull();
  });

  it('opens the public repo then dismisses', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<SponsorNudge />);
    await screen.findByRole('dialog', { name: 'Support Zana' });
    fireEvent.click(screen.getByRole('button', { name: 'Star on GitHub' }));
    expect(open).toHaveBeenCalledWith(GITHUB_REPO_URL, '_blank', 'noopener');
    expect(setConfig).toHaveBeenCalledWith({ sponsorPromptDismissed: true });
    expect(screen.queryByRole('dialog', { name: 'Support Zana' })).toBeNull();
    open.mockRestore();
  });
});
