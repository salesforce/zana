/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, MAX_EDITOR_TABS, parseTab, readStudioLayout, useStudioLayout, withoutTabs } from './studio-layout.js';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it('parses tabs strictly', () => {
  expect(parseTab({ id: 'agent:a', kind: 'agent', label: 'a', path: 'a.agent' })).toEqual({ id: 'agent:a', kind: 'agent', label: 'a', path: 'a.agent' });
  expect(parseTab({ id: 'apex:X', kind: 'apex', label: 'X', target: 'apex://X' })).toMatchObject({ kind: 'apex', target: 'apex://X' });
  expect(parseTab({ id: 'lwc:c/card', kind: 'lwc', label: 'c/card', target: 'c/card' })).toMatchObject({ kind: 'lwc', target: 'c/card' });
  expect(parseTab({ id: 'lwc:c/card', kind: 'lwc', label: 'c/card' })).toBeNull();
  expect(parseTab({ id: 'org-agents', kind: 'org', label: 'Org agents', target: 'agents' })).toMatchObject({ kind: 'org', target: 'agents' });
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
  // The explorer width is clamped; anything that is not a finite number is the default.
  for (const [stored, width] of [[320.4, 320], [50, 200], [9000, 480], ['300', null], [Number.NaN, null]] as const) {
    localStorage.setItem('k', JSON.stringify({ explorerWidth: stored }));
    expect(readStudioLayout('k').explorerWidth).toBe(width);
  }
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

it('remembers the Project / Org source choice', () => {
  localStorage.setItem('k', JSON.stringify({ actionOrigin: 'org' }));
  expect(readStudioLayout('k').actionOrigin).toBe('org');
  localStorage.setItem('k', JSON.stringify({ actionOrigin: 'sandbox' }));
  expect(readStudioLayout('k').actionOrigin).toBe('project');
  const { result } = renderHook(() => useStudioLayout('p-origin'));
  act(() => result.current.patch({ actionOrigin: 'org' }));
  expect(readStudioLayout('salesforce:studio:p-origin').actionOrigin).toBe('org');
});

it('closes several tabs and picks the next active tab', () => {
  const tab = (id: string) => ({ id, kind: 'apex' as const, label: id, target: `apex://${id}` });
  const state = { ...DEFAULT_LAYOUT, tabs: ['a', 'b', 'c', 'd'].map(tab), activeTab: 'c' };
  expect(withoutTabs(state, ['x'])).toBe(state);
  expect(withoutTabs(state, ['a', 'c', 'd'], 'b')).toMatchObject({ activeTab: 'b', tabs: [tab('b')] });
  expect(withoutTabs(state, ['b', 'c']).activeTab).toBe('a');
  expect(withoutTabs(state, ['a', 'b', 'c']).activeTab).toBe('d');
  expect(withoutTabs(state, ['d']).activeTab).toBe('c');
  expect(withoutTabs(state, ['a', 'b', 'c', 'd'], 'b')).toMatchObject({ tabs: [], activeTab: null });
  const { result } = renderHook(() => useStudioLayout('p-many'));
  act(() => { for (const id of ['a', 'b', 'c']) result.current.openTab(tab(id)); });
  act(() => result.current.closeTabs(['a', 'c'], 'b'));
  expect(result.current.state).toMatchObject({ tabs: [tab('b')], activeTab: 'b' });
});
