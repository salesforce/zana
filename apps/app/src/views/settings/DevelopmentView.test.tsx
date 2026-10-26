// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { DevelopmentView } from './DevelopmentView.js';

afterEach(cleanup);

it.each([undefined, false, true])('persists bundled plugin development, off by default (%s)', enabled => {
  const update = vi.fn();
  render(<DevelopmentView config={{ pluginDevelopmentEnabled: enabled } as AppConfig} onUpdate={update} />);
  const toggle = screen.getByRole('switch', { name: 'Bundled plugin development' });
  expect(toggle.getAttribute('aria-checked')).toBe(String(enabled ?? false));
  fireEvent.click(toggle);
  expect(update).toHaveBeenCalledExactlyOnceWith({ pluginDevelopmentEnabled: !(enabled ?? false) });
  expect(screen.getByText(/currently loaded plugins keep running/)).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Bundled plugins' }).closest('[data-settings-target]')?.getAttribute('data-settings-target'))
    .toBe('development.bundled-plugins');
});
