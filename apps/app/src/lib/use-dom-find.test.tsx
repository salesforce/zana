// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useDomFind } from './use-dom-find.js';

describe('useDomFind openBar', () => {
  it('opens the bar and asks the field for focus, as Ctrl+F in the surface does', () => {
    const content = { current: document.createElement('div') };
    const host = { current: document.createElement('div') };
    const { result } = renderHook(() => useDomFind(content, host, 'key'));
    expect(result.current.open).toBe(false);
    act(() => result.current.openBar());
    expect(result.current.open).toBe(true);
    expect(result.current.focusRequest).toBe(1);
    act(() => result.current.openBar());
    expect(result.current.focusRequest).toBe(2);
  });
});
