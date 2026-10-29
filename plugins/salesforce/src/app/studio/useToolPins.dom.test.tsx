/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readToolPins, useToolPins } from './useToolPins.js';

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('accepts only bounded agent paths for the four supported tools', () => {
  localStorage.setItem('pins', JSON.stringify({ preview: 'A.agent', graph: 'B.agent', tests: '', 'org-preview': 4, assistant: 'x', actions: 'x' }));
  expect(readToolPins('pins')).toEqual({ preview: 'A.agent', graph: 'B.agent' });
  for (const value of ['{', 'null', '[]', '"hello"', JSON.stringify({ preview: 'x'.repeat(4097) })]) {
    localStorage.setItem('pins', value);
    expect(readToolPins('pins')).toEqual({});
  }
});

it('persists independent tool pins across remounts and forgets a closed owner', () => {
  const first = renderHook(() => useToolPins('project'));
  act(() => { first.result.current.pin('preview', 'A.agent'); first.result.current.pin('tests', 'B.agent'); });
  const before = first.result.current.pins;
  act(() => first.result.current.pin('preview', 'A.agent'));
  expect(first.result.current.pins).toBe(before);
  first.unmount();
  const next = renderHook(() => useToolPins('project'));
  expect(next.result.current.pins).toEqual({ preview: 'A.agent', tests: 'B.agent' });
  act(() => next.result.current.pin('preview', null));
  expect(next.result.current.pins).toEqual({ tests: 'B.agent' });
  act(() => next.result.current.forget('B.agent'));
  expect(next.result.current.pins).toEqual({});
  const other = renderHook(() => useToolPins('another-project'));
  expect(other.result.current.pins).toEqual({});
});

it('works when layout storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('full'); });
  const hook = renderHook(() => useToolPins('project'));
  act(() => hook.result.current.pin('graph', 'A.agent'));
  expect(hook.result.current.pins).toEqual({ graph: 'A.agent' });
});
