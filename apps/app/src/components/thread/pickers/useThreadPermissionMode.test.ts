// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useThreadPermissionMode } from './useThreadPermissionMode.js';

afterEach(cleanup);
const modes = ['accept-edits', 'auto', 'full'];

describe('thread permission selection', () => {
  it.each(modes)('restores %s after detail arrives and keeps an unsent user choice across polling', (mode) => {
    const { result, rerender } = renderHook(useThreadPermissionMode, {
      initialProps: { threadId: 'one', initialPermissionMode: null as string | null, supportedModes: modes }
    });
    expect(result.current.permissionMode).toBe('accept-edits');
    rerender({ threadId: 'one', initialPermissionMode: mode, supportedModes: modes });
    expect(result.current.permissionMode).toBe(mode);
    act(() => result.current.setPermissionMode('auto'));
    rerender({ threadId: 'one', initialPermissionMode: mode, supportedModes: [...modes] });
    expect(result.current.permissionMode).toBe('auto');
  });

  it('resets an unsent choice when changing threads, including a legacy thread without saved permissions', () => {
    const { result, rerender } = renderHook(useThreadPermissionMode, {
      initialProps: { threadId: 'one', initialPermissionMode: null as string | null }
    });
    act(() => result.current.setPermissionMode('full'));
    rerender({ threadId: 'two', initialPermissionMode: null });
    expect(result.current.permissionMode).toBe('accept-edits');
    rerender({ threadId: 'two', initialPermissionMode: 'full' });
    expect(result.current.permissionMode).toBe('full');
    rerender({ threadId: 'three', initialPermissionMode: 'auto' });
    expect(result.current.permissionMode).toBe('auto');
  });

  it('hydrates Full immediately and reconciles providers that offer only one mode', () => {
    const { result, rerender } = renderHook(useThreadPermissionMode, {
      initialProps: { initialPermissionMode: 'full', supportedModes: modes }
    });
    expect(result.current.permissionMode).toBe('full');
    rerender({ initialPermissionMode: 'full', supportedModes: ['accept-edits'] });
    expect(result.current.permissionMode).toBe('accept-edits');
    rerender({ initialPermissionMode: 'full', supportedModes: [] });
    expect(result.current.permissionMode).toBe('full');
  });

  it('uses Edits for a new thread and ignores malformed choices', () => {
    const { result } = renderHook(() => useThreadPermissionMode({ initialPermissionMode: 'invalid' }));
    expect(result.current.permissionMode).toBe('accept-edits');
    act(() => result.current.setPermissionMode('invalid'));
    expect(result.current.permissionMode).toBe('accept-edits');
  });
});
