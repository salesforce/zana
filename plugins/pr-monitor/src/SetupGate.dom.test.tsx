/**
 * @vitest-environment happy-dom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PR_MONITOR_SETTINGS } from '../lib/types.js';
import { SetupGate } from './app/SetupGate.js';

describe('SetupGate', () => {
  it('persists default settings when the user gets started', async () => {
    const onSave = vi.fn(async () => undefined);
    const { container } = render(<SetupGate onSave={onSave} />);
    expect(screen.getByRole('heading', { name: 'Set up PR Monitor' })).toBeTruthy();
    expect(container.querySelector('.prm-empty-actions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(DEFAULT_PR_MONITOR_SETTINGS);
    });
  });
});
