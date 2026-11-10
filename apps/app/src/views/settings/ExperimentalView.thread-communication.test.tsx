// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ExperimentalView } from './ExperimentalView.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { entries } from '../../lib/settings-search/entries/experimental.js';
afterEach(cleanup);
it('defaults thread communication on and preserves explicit opt-out', () => {
  const onUpdate = vi.fn();
  const show = (config: Partial<AppConfig>) => <ExperimentalView config={config as AppConfig} onConfigDraft={vi.fn()} onUpdate={onUpdate} />;
  const { rerender } = render(show({}));
  const toggle = screen.getByRole('switch', { name: 'Enable thread communication' });
  expect(toggle.getAttribute('aria-checked')).toBe('true');
  fireEvent.click(toggle); expect(onUpdate).toHaveBeenCalledWith({ threadCommunicationEnabled: false });
  rerender(show({ threadCommunicationEnabled: false }));
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle); expect(onUpdate).toHaveBeenLastCalledWith({ threadCommunicationEnabled: true });
  const entry = entries.find(row => row.id === 'experimental.thread-communication')!;
  expect(entry.anchor).toBe('thread-communication');
});
