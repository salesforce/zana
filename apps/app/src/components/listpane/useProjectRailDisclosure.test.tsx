// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useProjectRailDisclosure } from './useProjectRailDisclosure.js';

afterEach(cleanup);
it('opens populated phone trees automatically and keeps local toggles out of desktop preferences', () => {
  const save = vi.fn();
  const { result, rerender } = renderHook(({ mobile }) => useProjectRailDisclosure(mobile, { savedOpen: true, savedClosed: false }, save), { initialProps: { mobile: true } });
  expect(result.current.isExpanded('savedOpen', true)).toBe(true);
  expect(result.current.isExpanded('savedClosed', true)).toBe(true);
  expect(result.current.isExpanded('new', false)).toBe(false);
  expect(result.current.isExpanded('new', true)).toBe(true);
  act(() => result.current.setExpanded('new', false));
  expect(result.current.isExpanded('new', true)).toBe(false);
  act(() => result.current.setExpanded('new', true));
  expect(result.current.isExpanded('new', true)).toBe(true);
  expect(save).not.toHaveBeenCalled();
  rerender({ mobile: false });
  expect(result.current.isExpanded('savedOpen', true)).toBe(true);
  expect(result.current.isExpanded('savedClosed', true)).toBe(false);
  expect(result.current.isExpanded('new', true)).toBe(true);
  expect(result.current.isExpanded('empty', false)).toBe(false);
  act(() => result.current.setExpanded('new', false));
  expect(save).toHaveBeenCalledWith('new', false);
});

it('reopens session trees when a new mobile drawer is mounted', () => {
  const save = vi.fn();
  const first = renderHook(() => useProjectRailDisclosure(true, {}, save));
  act(() => first.result.current.setExpanded('project', false));
  expect(first.result.current.isExpanded('project', true)).toBe(false);
  first.unmount();
  const next = renderHook(() => useProjectRailDisclosure(true, {}, save));
  expect(next.result.current.isExpanded('project', true)).toBe(true);
  expect(save).not.toHaveBeenCalled();
});
