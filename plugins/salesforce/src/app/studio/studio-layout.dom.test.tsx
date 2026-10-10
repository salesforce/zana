/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, MAX_EDITOR_TABS, parseTab, readStudioLayout, useStudioLayout } from './studio-layout.js';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('parses tabs strictly', () => {
  expect(parseTab({ id: 'agent:a', kind: 'agent', label: 'a', path: 'a.agent' })).toEqual({ id: 'agent:a', kind: 'agent', label: 'a', path: 'a.agent' });
  expect(parseTab({ id: 'apex:X', kind: 'apex', label: 'X', target: 'apex://X' })).toMatchObject({ kind: 'apex', target: 'apex://X' });
  for (const bad of [null, 4, {}, { id: 'x', kind: 'agent', label: 'x' }, { id: 'x', kind: 'weird', label: 'x' }, { id: '', kind: 'apex', label: 'x' }, { id: 'x', kind: 'apex', label: '' }]) {
    expect(parseTab(bad)).toBeNull();
  }
});

it('falls back to defaults for missing, corrupt or hostile storage', () => {
  expect(readStudioLayout('k')).toEqual(DEFAULT_LAYOUT);
  localStorage.setItem('k', '{nope');
  expect(readStudioLayout('k')).toEqual(DEFAULT_LAYOUT);
  localStorage.setItem('k', JSON.stringify('str'));
  expect(readStudioLayout('k')).toEqual(DEFAULT_LAYOUT);
  localStorage.setItem('k', JSON.stringify({ tool: 'evil', tabs: 'x', activeTab: 4, bottomTab: 'nope', bottomOpen: 'yes', explorerOpen: false, share: 1, railSeeded: true }));
  expect(readStudioLayout('k')).toEqual({ ...DEFAULT_LAYOUT, explorerOpen: false, railSeeded: true });
  localStorage.setItem('k', JSON.stringify({ collapsedSections: ['apex', 'apex', 7, '', 'x'.repeat(41), 'org-agent'] }));
  expect(readStudioLayout('k').collapsedSections).toEqual(['apex', 'org-agent']);
  localStorage.setItem('k', JSON.stringify({ collapsedSections: 'apex' }));
  expect(readStudioLayout('k').collapsedSections).toEqual([]);
});

it('keeps Lightning Type tabs', () => {
  expect(parseTab({ id: 'type:c__Order', kind: 'type', label: 'c__Order', target: 'c__Order' })).toEqual({ id: 'type:c__Order', kind: 'type', label: 'c__Order', target: 'c__Order' });
  expect(parseTab({ id: 'type:x', kind: 'type', label: 'x' })).toBeNull();
});

it('keeps valid persisted tabs, drops duplicates and caps the list', () => {
  const many = Array.from({ length: 30 }, (_, index) => ({ id: `apex:${index}`, kind: 'apex', label: `n${index}`, target: `apex://n${index}` }));
  localStorage.setItem('k', JSON.stringify({ tool: 'graph', tabs: [...many, many[0]], activeTab: 'apex:3', bottomOpen: true, bottomTab: 'trace' }));
  const state = readStudioLayout('k');
  expect(state.tabs).toHaveLength(MAX_EDITOR_TABS);
  expect(state).toMatchObject({ tool: 'graph', activeTab: 'apex:3', bottomOpen: true, bottomTab: 'trace' });
  localStorage.setItem('k', JSON.stringify({ tabs: many.slice(0, 2), activeTab: 'missing' }));
  expect(readStudioLayout('k').activeTab).toBe('apex:0');
});

it('opens, selects, closes and persists per scope', () => {
  const { result, rerender } = renderHook(({ scope }) => useStudioLayout(scope), { initialProps: { scope: 'p1' } });
  const a = { id: 'agent:a', kind: 'agent' as const, label: 'a', path: 'a.agent' };
  const b = { id: 'agent:b', kind: 'agent' as const, label: 'b', path: 'b.agent' };
  act(() => { result.current.openTab(a); result.current.openTab(b); });
  expect(result.current.state.activeTab).toBe('agent:b');
  act(() => result.current.openTab({ ...a, label: 'renamed' }));
  expect(result.current.state.tabs.map(tab => tab.label)).toEqual(['renamed', 'b']);
  act(() => result.current.selectTab('agent:b'));
  act(() => result.current.selectTab('nope'));
  expect(result.current.state.activeTab).toBe('agent:b');
  act(() => result.current.closeTab('missing'));
  act(() => result.current.closeTab('agent:b'));
  expect(result.current.state.activeTab).toBe('agent:a');
  act(() => result.current.closeTab('agent:a'));
  expect(result.current.state).toMatchObject({ tabs: [], activeTab: null });
  act(() => result.current.openTab(a));
  act(() => result.current.openTab(b));
  act(() => result.current.closeTab('agent:a')); // closing an inactive tab keeps the selection
  expect(result.current.state.activeTab).toBe('agent:b');
  act(() => result.current.patch({ tool: 'graph', bottomOpen: true }));
  expect(JSON.parse(localStorage.getItem('salesforce:studio:p1')!)).toMatchObject({ tool: 'graph', bottomOpen: true });
  rerender({ scope: 'p2' });
  expect(result.current.state.tool).toBe('code');
});

it('tolerates storage failures', () => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = () => { throw new Error('quota'); };
  try {
    const { result } = renderHook(() => useStudioLayout('p'));
    act(() => result.current.patch({ explorerOpen: false }));
    expect(result.current.state.explorerOpen).toBe(false);
  } finally { Storage.prototype.setItem = original; }
});
