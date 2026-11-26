/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ModelReasoningPicker } from './ModelReasoningPicker.js';

vi.mock('../../../lib/app-surface.js', () => ({ getAppSurface: () => 'desktop' }));

afterEach(cleanup);

function picker(count: number, switchable = true, onUseDefaultProvider?: () => void) {
  return <ModelReasoningPicker
    providerOptions={Array.from({ length: count }, (_, i) => ({ value: `provider-${i}`, label: `Provider ${i}` }))}
    selectedProviderId="provider-0"
    onSelectedProviderChange={switchable ? () => undefined : undefined}
    onUseDefaultProvider={onUseDefaultProvider}
    modelValue="default"
    modelOptions={[{ value: 'default', label: 'Default' }]}
    onModelChange={() => undefined}
  />;
}

it('resizes an open picker as installed harnesses are added, with bounded width', () => {
  const view = render(picker(2));
  fireEvent.click(screen.getByTestId('model-reasoning-picker-trigger'));
  const menu = screen.getByTestId('model-reasoning-picker-menu');
  const initial = parseFloat(menu.style.width);
  view.rerender(picker(10));
  const expanded = parseFloat(menu.style.width);
  expect(expanded).toBeGreaterThan(initial);
  expect(screen.getAllByRole('tab')).toHaveLength(10);
  view.rerender(picker(30));
  expect(parseFloat(menu.style.width)).toBeGreaterThanOrEqual(expanded);
  expect(parseFloat(menu.style.width)).toBeLessThanOrEqual(320);
  expect(screen.getAllByRole('tab')).toHaveLength(30);
});

it('keeps the model-only picker compact when the thread provider is locked', () => {
  render(picker(30, false));
  fireEvent.click(screen.getByTestId('model-reasoning-picker-trigger'));
  expect(screen.queryByRole('tablist')).toBeNull();
  expect(parseFloat(screen.getByTestId('model-reasoning-picker-menu').style.width)).toBe(208);
});

it('offers a reset inside the open picker when the composer has a harness override', () => {
  const reset = vi.fn();
  const view = render(picker(2));
  const trigger = screen.getByRole('button', { name: 'Provider and model' });
  fireEvent.click(trigger);
  expect(screen.queryByRole('button', { name: 'Use default' })).toBeNull();
  view.rerender(picker(2, true, reset));
  fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
  expect(reset).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
