/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentforceTarget } from './use-agentforce-target.js';

const scope = { pluginId: 'salesforce', projectId: 'p1', threadId: 't1', surface: 'preview' as const, tabId: 'preview-1' };
const STORAGE = 'salesforce.agentforce-targets.v1';
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('shared Agentforce target', () => {
  it('keeps resource window selections independent from the main Studio and sibling resources', () => {
    const main = renderHook(() => useAgentforceTarget(scope));
    const a = renderHook(() => useAgentforceTarget({ ...scope, resourceId: 'A.agent', params: { path: 'A.agent' } }));
    const b = renderHook(() => useAgentforceTarget({ ...scope, resourceId: 'B.agent', params: { path: 'B.agent' } }));
    act(() => main.result.current.select({ path: 'Main.agent' }));
    expect(a.result.current.target?.path).toBe('A.agent');
    expect(b.result.current.target?.path).toBe('B.agent');
    act(() => a.result.current.select({ path: 'A2.agent' }));
    expect(main.result.current.target?.path).toBe('Main.agent');
    expect(b.result.current.target?.path).toBe('B.agent');
  });

  it('restores a picker choice after remount, ahead of the original card params', () => {
    const input = { ...scope, params: { path: 'Original.agent' } };
    const first = renderHook(() => useAgentforceTarget(input));
    act(() => first.result.current.select({ path: 'Chosen.agent' }));
    first.unmount();
    const next = renderHook(() => useAgentforceTarget(input));
    expect(next.result.current.target).toEqual({ path: 'Chosen.agent' });
  });

  it('shares selection in both directions and honors new card requests, including a nonce', () => {
    const preview = renderHook(() => useAgentforceTarget(scope));
    const editor = renderHook(() => useAgentforceTarget({ ...scope, surface: 'playground', tabId: 'editor' }));
    act(() => editor.result.current.select({ path: 'Code.agent' }));
    expect(preview.result.current.target).toEqual({ path: 'Code.agent' });
    act(() => preview.result.current.select({ apiName: 'Published' }));
    expect(editor.result.current.target).toEqual({ apiName: 'Published' });
    const card = renderHook(({ params }) => useAgentforceTarget({ ...scope, params }), { initialProps: { params: { path: 'Card.agent', nonce: 1 } } });
    expect(preview.result.current.target?.path).toBe('Card.agent');
    act(() => editor.result.current.select({ path: 'Later.agent' }));
    card.rerender({ params: { path: 'Card.agent', nonce: 2 } });
    expect(preview.result.current.target?.path).toBe('Card.agent');
    card.rerender({ params: { path: 'Other.agent', nonce: 3 } });
    expect(preview.result.current.target?.path).toBe('Other.agent');
  });

  it('keeps projects, threads and plugin instances isolated and resets on a scope change', () => {
    const view = renderHook(({ threadId }) => useAgentforceTarget({ ...scope, threadId }), { initialProps: { threadId: 't1' } });
    act(() => view.result.current.select({ path: 'Private.agent' }));
    for (const input of [{ ...scope, projectId: 'p2' }, { ...scope, threadId: 't2' }, { ...scope, pluginId: 'other' }]) {
      const other = renderHook(() => useAgentforceTarget(input));
      expect(other.result.current.target).toBeNull();
    }
    view.rerender({ threadId: 't2' });
    expect(view.result.current.target).toBeNull();
    view.rerender({ threadId: 't1' });
    expect(view.result.current.target?.path).toBe('Private.agent');
  });

  it('does not treat an Apex dependency API name as the editor agent', () => {
    const view = renderHook(() => useAgentforceTarget({ ...scope, surface: 'playground', params: { apiName: 'Lookup', readOnly: true } }));
    expect(view.result.current.target).toBeNull();
    const published = renderHook(() => useAgentforceTarget({ ...scope, params: { apiName: 'Published' } }));
    published.unmount();
    expect(renderHook(() => useAgentforceTarget(scope)).result.current.target).toEqual({ apiName: 'Published' });
  });

  it('ignores malformed recovery and stays usable when storage fails', () => {
    localStorage.setItem(STORAGE, '{');
    expect(renderHook(() => useAgentforceTarget(scope)).result.current.target).toBeNull();
    localStorage.setItem(STORAGE, '{}');
    expect(renderHook(() => useAgentforceTarget(scope)).result.current.target).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('full'); });
    const view = renderHook(() => useAgentforceTarget({ ...scope, params: { path: 'Requested.agent' } }));
    act(() => view.result.current.select({ path: 'StillWorks.agent' }));
    expect(view.result.current.target?.path).toBe('StillWorks.agent');
  });

  it('bounds retained scopes and consumed tab requests', () => {
    for (let i = 0; i < 35; i++) {
      const view = renderHook(() => useAgentforceTarget({ ...scope, threadId: `t${i}`, params: { path: 'Agent.agent' } }));
      view.unmount();
    }
    expect(JSON.parse(localStorage.getItem(STORAGE)!)).toHaveLength(30);
    for (let i = 0; i < 25; i++) {
      const view = renderHook(() => useAgentforceTarget({ ...scope, tabId: `tab${i}`, params: { path: 'Agent.agent' } }));
      view.unmount();
    }
    expect(Object.keys(JSON.parse(localStorage.getItem(STORAGE)!)[0].requests)).toHaveLength(20);
  });

  it('handles cross-window changes and removes subscriptions on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener');
    const view = renderHook(() => useAgentforceTarget(scope));
    act(() => { localStorage.setItem(STORAGE, JSON.stringify([{ scope: JSON.stringify(['salesforce', 'p1', 't1']), target: { path: 'Remote.agent' }, requests: {} }])); window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' })); });
    expect(view.result.current.target).toBeNull();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: STORAGE })));
    expect(view.result.current.target?.path).toBe('Remote.agent');
    act(() => { localStorage.clear(); window.dispatchEvent(new StorageEvent('storage')); });
    expect(view.result.current.target).toBeNull();
    view.unmount();
    expect(remove).toHaveBeenCalledWith('sf:agentforce-target-changed', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
  });
});
