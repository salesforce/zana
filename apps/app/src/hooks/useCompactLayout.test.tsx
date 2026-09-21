// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useCompactLayout } from './useCompactLayout';
const surface = vi.hoisted(() => ({ value: 'web' }));
vi.mock('../lib/app-surface.js', () => ({ getAppSurface: () => surface.value }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); surface.value = 'web'; });

it('tracks the phone/tablet breakpoint and removes its listener', () => {
  let matches = true;
  let update = () => {};
  const remove = vi.fn();
  const media = vi.fn(() => ({ get matches() { return matches; }, addEventListener: (_: string, cb: () => void) => { update = cb; }, removeEventListener: remove }));
  vi.stubGlobal('matchMedia', media);
  const { result, unmount } = renderHook(useCompactLayout);
  expect(result.current).toBe(true);
  expect(media).toHaveBeenCalledWith('(max-width: 1024px)');
  act(() => { matches = false; update(); });
  expect(result.current).toBe(false);
  unmount();
  expect(remove).toHaveBeenCalledWith('change', update);
});

it('does not subscribe on desktop or when media queries are unavailable', () => {
  const media = vi.fn();
  vi.stubGlobal('matchMedia', media);
  surface.value = 'desktop';
  const desktop = renderHook(useCompactLayout);
  expect(desktop.result.current).toBe(false);
  expect(media).not.toHaveBeenCalled();
  desktop.unmount();
  surface.value = 'mobile';
  vi.stubGlobal('matchMedia', undefined);
  expect(renderHook(useCompactLayout).result.current).toBe(false);
});
