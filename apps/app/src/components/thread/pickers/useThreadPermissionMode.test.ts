// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useThreadPermissionMode } from './useThreadPermissionMode.js';
import { FULL_ACCESS_BY_DEFAULT_KEY } from '../../../lib/composer-permission-preference.js';
import { writeBooleanPreference } from '../../../lib/boolean-preference.js';
import { ComposerSession, resetComposerSessions } from '../../composer/composer-session.js';

afterEach(cleanup);
beforeEach(() => { localStorage.clear(); resetComposerSessions(); });
const modes = ['accept-edits', 'auto', 'full'];

describe('thread permission selection', () => {
  it('restores an explicit policy across remount and ignores late defaults', () => {
    const session = new ComposerSession();
    const view = renderHook(() => useThreadPermissionMode({ session, threadId: 'one', initialPermissionMode: 'auto', supportedModes: modes }));
    act(() => view.result.current.setPermissionMode('accept-edits'));
    view.unmount();
    const restored = renderHook(() => useThreadPermissionMode({ session, threadId: 'one', initialPermissionMode: 'full', supportedModes: modes }));
    expect(restored.result.current.permissionMode).toBe('accept-edits');
  });

  it('reports an unavailable saved policy without escalating it silently', () => {
    const session = new ComposerSession();
    session.setSetting('permissionMode', 'auto');
    const view = renderHook(() => useThreadPermissionMode({ session, supportedModes: ['full'] }));
    expect(view.result.current.selectionError).toMatch(/saved permission policy/);
    // The picker keeps showing the unavailable pick (its placeholder), not offered[0].
    expect(view.result.current.permissionMode).toBe('auto');
    act(() => view.result.current.setPermissionMode('full'));
    expect(view.result.current.selectionError).toBeNull();
  });
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

  it('prefers automatic review for a new agent and ignores malformed choices', () => {
    const { result } = renderHook(() => useThreadPermissionMode({ initialPermissionMode: 'invalid' }));
    expect(result.current.permissionMode).toBe('auto');
    act(() => result.current.setPermissionMode('invalid'));
    expect(result.current.permissionMode).toBe('auto');
  });

  it('uses Edits when automatic review is unavailable and restores Auto when it becomes available', () => {
    const { result, rerender } = renderHook(useThreadPermissionMode, {
      initialProps: { supportedModes: ['accept-edits', 'full'] }
    });
    expect(result.current.permissionMode).toBe('accept-edits');
    rerender({ supportedModes: modes });
    expect(result.current.permissionMode).toBe('auto');
    rerender({ supportedModes: [] });
    expect(result.current.permissionMode).toBe('auto');
    rerender({ supportedModes: ['accept-edits'] });
    expect(result.current.permissionMode).toBe('accept-edits');
  });

  it.each(['accept-edits', 'full'])('keeps an explicit %s choice when automatic review becomes available', (mode) => {
    const { result, rerender } = renderHook(useThreadPermissionMode, {
      initialProps: { supportedModes: ['accept-edits', 'full'] }
    });
    act(() => result.current.setPermissionMode(mode));
    rerender({ supportedModes: modes });
    expect(result.current.permissionMode).toBe(mode);
  });

  it.each(modes)('honors an initial %s choice for a new agent', (mode) => {
    const { result } = renderHook(() => useThreadPermissionMode({ initialPermissionMode: mode, supportedModes: modes }));
    expect(result.current.permissionMode).toBe(mode);
  });

  it('uses the saved preference for new agents and reacts to settings changes', () => {
    writeBooleanPreference(FULL_ACCESS_BY_DEFAULT_KEY, false);
    const { result, rerender } = renderHook(() => useThreadPermissionMode({ supportedModes: modes }));
    expect(result.current.permissionMode).toBe('auto');
    act(() => writeBooleanPreference(FULL_ACCESS_BY_DEFAULT_KEY, true));
    expect(result.current.permissionMode).toBe('full');
    act(() => result.current.setPermissionMode('accept-edits'));
    rerender();
    expect(result.current.permissionMode).toBe('accept-edits');
    act(() => writeBooleanPreference(FULL_ACCESS_BY_DEFAULT_KEY, false));
    expect(result.current.permissionMode).toBe('accept-edits');
  });

  it('keeps explicit and existing thread permissions when the preference changes', () => {
    const { result } = renderHook(() => useThreadPermissionMode({ threadId: 'one', initialPermissionMode: 'auto' }));
    act(() => writeBooleanPreference(FULL_ACCESS_BY_DEFAULT_KEY, false));
    expect(result.current.permissionMode).toBe('auto');
    act(() => writeBooleanPreference(FULL_ACCESS_BY_DEFAULT_KEY, true));
    expect(result.current.permissionMode).toBe('auto');
  });

  it('retains an opted-in Full default while a provider with fewer supported permissions loads', () => {
    writeBooleanPreference(FULL_ACCESS_BY_DEFAULT_KEY, true);
    const { result, rerender } = renderHook(useThreadPermissionMode, {
      initialProps: { supportedModes: ['accept-edits'] }
    });
    expect(result.current.permissionMode).toBe('accept-edits');
    rerender({ supportedModes: modes });
    expect(result.current.permissionMode).toBe('full');
  });
});
