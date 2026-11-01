// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../lib/resolveIcon.js', () => ({ resolveIcon: (name: string) => ({ size }: { size: number }) => <svg data-testid="fallback" data-icon={name} width={size} /> }));
import { PluginBrandIcon } from './PluginBrandIcon.js';

afterEach(cleanup);

it('preserves an SVG as an image with explicit sizing and no duplicate accessible label', () => {
  const { container } = render(<PluginBrandIcon src="/plugins/example/assets/brand.svg" size={28} />);
  const image = container.querySelector('img')!;
  expect(image.getAttribute('src')).toBe('/plugins/example/assets/brand.svg');
  expect(image.hidden).toBe(false);
  expect(image.getAttribute('alt')).toBe('');
  expect(image.width).toBe(28);
  expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(container.querySelector('[style*="mask"]')).toBeNull();
});

it('falls back after an image error and loads a new source when identity changes', () => {
  const { container, rerender } = render(<PluginBrandIcon src="/missing.png" icon="Box" />);
  fireEvent.error(container.querySelector('img')!);
  expect(screen.getByTestId('fallback').getAttribute('data-icon')).toBe('Box');
  rerender(<PluginBrandIcon src="data:image/png;base64,YQ==" icon="Box" />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,YQ==');
  expect(screen.queryByTestId('fallback')).toBeNull();
});

it('keeps generic icons for plugins without artwork and handles path-like fallbacks', () => {
  const { rerender } = render(<PluginBrandIcon icon="Wrench" />);
  expect(screen.getByTestId('fallback').getAttribute('data-icon')).toBe('Wrench');
  expect(screen.getByTestId('fallback').getAttribute('width')).toBe('20');
  rerender(<PluginBrandIcon icon="./missing.svg" />);
  expect(screen.getByTestId('fallback').getAttribute('data-icon')).toBe('Puzzle');
  rerender(<PluginBrandIcon />);
  expect(screen.getByTestId('fallback').getAttribute('data-icon')).toBe('Puzzle');
});
