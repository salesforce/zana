/** @vitest-environment happy-dom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, MAX_AGENTS, MAX_EDITOR_TABS, dockStudioViews, parseTab, readStudioLayout, useStudioLayout, viewTab, withAgent, withoutTabs } from './studio-layout.js';

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

const ref = (name: string) => ({ path: `${name}.agent`, label: name });
const manyAgents = (count: number) => Array.from({ length: count }, (_, index) => ref(`a${index}`));

it('parses view tabs only for the four view kinds', () => {
  for (const target of ['preview', 'tests', 'graph', 'org-preview']) expect(parseTab({ id: `view:${target}`, kind: 'view', label: target, target })).toMatchObject({ kind: 'view', target });
  expect(parseTab({ id: 'view:x', kind: 'view', label: 'x', target: 'release' })).toBeNull();
  expect(parseTab({ id: 'view:x', kind: 'view', label: 'x' })).toBeNull();
});

it('opens agents with a Script tab, keeps a workspace per agent and switches between them', () => {
  const { result } = renderHook(() => useStudioLayout('p-agents'));
  act(() => { result.current.openAgent('a.agent', 'a'); result.current.openAgent('b.agent', 'b'); });
  expect(result.current.state).toMatchObject({ activeAgent: 'b.agent', activeTab: 'agent:b.agent' });
  expect(result.current.state.agents.map(agent => agent.path)).toEqual(['a.agent', 'b.agent']);
  act(() => result.current.openTab(viewTab('preview')));
  act(() => result.current.patch({ bottomOpen: true, bottomTab: 'trace', rail: 'comments' }));
  act(() => result.current.patchWorkspace('b.agent', { threadId: 't-1' }));
  expect(result.current.state).toMatchObject({ bottomOpen: true, rail: 'comments', threadId: 't-1', activeTab: 'view:preview' });
  act(() => result.current.selectAgent('a.agent'));
  expect(result.current.state).toMatchObject({ activeAgent: 'a.agent', activeTab: 'agent:a.agent', bottomOpen: false, rail: null });
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:a.agent']);
  expect(result.current.state.threadId).toBeUndefined();
  act(() => result.current.selectAgent('nope'));
  expect(result.current.state.activeAgent).toBe('a.agent');
  act(() => result.current.selectAgent('b.agent'));
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:b.agent', 'view:preview']);
  act(() => result.current.openAgent('a.agent', 'renamed'));
  expect(result.current.state.agents[0]).toEqual({ path: 'a.agent', label: 'renamed' });
  expect(result.current.state.tabs[0]).toMatchObject({ label: 'renamed' });
  act(() => result.current.patchWorkspace('missing.agent', { threadId: 'x' }));
  expect(result.current.state.workspaces['missing.agent']).toBeUndefined();
});

it('keeps Script and the requested Tests view when a full workspace switches agents and reloads', () => {
  const { result } = renderHook(() => useStudioLayout('full-workspace'));
  const path = 'GuiAgentReview.agent';
  act(() => {
    result.current.openAgent(path, 'GuiAgentReview');
    for (let index = 0; index < 9; index++) result.current.openTab({ id: `apex:Dependency${index}`, kind: 'apex', label: `Dependency${index}`, target: `apex://Dependency${index}` });
    result.current.openTab(viewTab('preview'));
    result.current.openTab(viewTab('graph'));
  });
  expect(result.current.state.tabs).toHaveLength(MAX_EDITOR_TABS);
  act(() => result.current.openTab(viewTab('tests')));
  const expected = ['agent:GuiAgentReview.agent', ...Array.from({ length: 8 }, (_, index) => `apex:Dependency${index + 1}`), 'view:preview', 'view:graph', 'view:tests'];
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(expected);
  expect(result.current.state.activeTab).toBe('view:tests');
  act(() => result.current.openAgent('Agent_Opp_1.agent', 'Agent_Opp_1'));
  act(() => {
    result.current.selectAgent(path);
    result.current.openAgent(path, 'GuiAgentReview');
  });
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(expected);
  expect(result.current.state.activeTab).toBe('view:tests');
  const restored = readStudioLayout('salesforce:studio:full-workspace');
  expect(restored.tabs.map(tab => tab.id)).toEqual(expected);
  expect(restored.activeTab).toBe('view:tests');
});

it('opens host views without evicting document tabs and remembers each agent’s panel selection', () => {
  const { result } = renderHook(() => useStudioLayout('docked'));
  act(() => result.current.openPanelView('preview')); // no agent: no orphan workspace
  expect(result.current.state.workspaces).toEqual({});
  act(() => {
    result.current.openAgent('a.agent', 'A');
    for (let i = 0; i < 11; i++) result.current.openTab({ id: `apex:${i}`, kind: 'apex', label: `A${i}`, target: `apex://A${i}` });
  });
  const documents = result.current.state.tabs;
  act(() => {
    result.current.openPanelView('preview');
    result.current.openPanelView('tests');
    result.current.openPanelView('preview');
  });
  expect(result.current.state.tabs).toEqual(documents);
  expect(result.current.state.activeTab).toBe('apex:10');
  expect(result.current.state.workspaces['a.agent']).toMatchObject({ panelViews: ['preview', 'tests'], rail: 'preview' });
  act(() => { result.current.openAgent('b.agent', 'B'); result.current.openPanelView('graph'); });
  act(() => result.current.selectAgent('a.agent'));
  expect(result.current.state.rail).toBe('preview');
  expect(result.current.state.tabs).toEqual(documents);
  const restored = readStudioLayout('salesforce:studio:docked');
  expect(restored.workspaces['b.agent']).toMatchObject({ panelViews: ['graph'], rail: 'graph' });
  expect(restored.workspaces['a.agent']).toMatchObject({ panelViews: ['preview', 'tests'], rail: 'preview' });
});

it('migrates saved editor views into each agent’s panel while keeping document focus', () => {
  const { result } = renderHook(() => useStudioLayout('migration'));
  act(() => {
    result.current.openAgent('a.agent', 'A');
    result.current.openTab(viewTab('graph'));
    result.current.openTab(viewTab('tests'));
    result.current.openAgent('b.agent', 'B');
    result.current.openTab(viewTab('preview'));
    result.current.selectTab('agent:b.agent');
  });
  act(() => result.current.dockViews());
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:b.agent']);
  expect(result.current.state.activeTab).toBe('agent:b.agent');
  expect(result.current.state.workspaces['b.agent']).toMatchObject({ panelViews: ['preview'], rail: null });
  act(() => result.current.selectAgent('a.agent'));
  expect(result.current.state.activeTab).toBe('agent:a.agent');
  expect(result.current.state.workspaces['a.agent']).toMatchObject({ panelViews: ['graph', 'tests'], rail: 'test' });
  expect(dockStudioViews(result.current.state)).toBe(result.current.state);
  const saved = JSON.parse(localStorage.getItem('salesforce:studio:migration')!);
  saved.workspaces['a.agent'].panelViews = ['preview', 'preview', 'org-preview', 'invalid', 3];
  saved.workspaces['b.agent'].panelViews = 'graph';
  saved.workspaces['b.agent'].rail = 'org-preview';
  localStorage.setItem('bounded', JSON.stringify(saved));
  const bounded = readStudioLayout('bounded');
  expect(bounded.workspaces['a.agent'].panelViews).toEqual(['preview', 'org-preview']);
  expect(bounded.workspaces['b.agent'].panelViews).toBeUndefined();
  expect(bounded.workspaces['b.agent'].rail).toBe('org-preview');
  expect(dockStudioViews(DEFAULT_LAYOUT)).toBe(DEFAULT_LAYOUT);
});

it.each([0, MAX_EDITOR_TABS - 1])('repairs a full workspace missing Script without dropping its active tab at index %s', activeIndex => {
  const tabs = Array.from({ length: MAX_EDITOR_TABS }, (_, index) => ({ id: `apex:Dependency${index}`, kind: 'apex' as const, label: `Dependency${index}`, target: `apex://Dependency${index}` }));
  const activeTab = tabs[activeIndex].id;
  const agent = ref('GuiAgentReview');
  const workspace = { ...DEFAULT_LAYOUT, agents: [agent], activeAgent: agent.path, workspaces: { [agent.path]: { tabs, activeTab, bottomOpen: false, bottomTab: 'problems' as const, rail: null } } };
  localStorage.setItem('missing-script', JSON.stringify(workspace));
  for (const repaired of [readStudioLayout('missing-script'), withAgent(workspace, agent)]) {
    expect(repaired.tabs).toHaveLength(MAX_EDITOR_TABS);
    expect(repaired.tabs[0].id).toBe(`agent:${agent.path}`);
    expect(repaired.tabs.some(tab => tab.id === activeTab)).toBe(true);
    expect(repaired.activeTab).toBe(activeTab);
    expect(repaired.tabs.some(tab => tab.id === tabs[activeIndex === 0 ? 1 : 0].id)).toBe(false);
  }
});

it('closing an agent selects the right neighbour, else the left, and drops its workspace', () => {
  const { result } = renderHook(() => useStudioLayout('p-close'));
  act(() => { for (const name of ['a', 'b', 'c']) result.current.openAgent(`${name}.agent`, name); });
  act(() => result.current.selectAgent('b.agent'));
  act(() => result.current.closeAgent('b.agent'));
  expect(result.current.state.activeAgent).toBe('c.agent');
  expect(result.current.state.workspaces['b.agent']).toBeUndefined();
  act(() => result.current.closeAgent('c.agent'));
  expect(result.current.state.activeAgent).toBe('a.agent');
  act(() => result.current.closeAgent('missing.agent'));
  act(() => result.current.closeAgent('a.agent'));
  expect(result.current.state).toMatchObject({ activeAgent: null, agents: [], tabs: [] });
  expect(result.current.state.workspaces).toEqual({});
});

it('closing an inactive agent keeps the active one', () => {
  const { result } = renderHook(() => useStudioLayout('p-inactive'));
  act(() => { result.current.openAgent('a.agent', 'a'); result.current.openAgent('b.agent', 'b'); });
  act(() => result.current.closeAgent('a.agent'));
  expect(result.current.state.activeAgent).toBe('b.agent');
});

it('caps open agents, dropping the oldest inactive workspace and keeping the new one', () => {
  const { result } = renderHook(() => useStudioLayout('p-cap'));
  act(() => { for (const agent of manyAgents(MAX_AGENTS + 3)) result.current.openAgent(agent.path, agent.label); });
  expect(result.current.state.agents).toHaveLength(MAX_AGENTS);
  expect(result.current.state.agents.at(-1)!.path).toBe(`a${MAX_AGENTS + 2}.agent`);
  expect(Object.keys(result.current.state.workspaces)).toHaveLength(MAX_AGENTS);
  expect(result.current.state.workspaces['a0.agent']).toBeUndefined();
  expect(result.current.state.activeAgent).toBe(`a${MAX_AGENTS + 2}.agent`);
});

it('round-trips workspaces and validates what it reads', () => {
  const stored = {
    tool: 'files', activeAgent: 'b.agent', explorerOpen: true,
    agents: [ref('a'), ref('b'), ref('a'), { path: '', label: 'x' }, 'junk', ...manyAgents(20)],
    workspaces: {
      'a.agent': { tabs: [{ id: 'agent:a.agent', kind: 'agent', label: 'a', path: 'a.agent' }, { id: 'view:graph', kind: 'view', label: 'Graph', target: 'graph' }, { id: 'view:bad', kind: 'view', label: 'bad', target: 'release' }], activeTab: 'view:graph', bottomOpen: true, bottomTab: 'trace', rail: 'assistant', threadId: 'th-1' },
      'b.agent': { tabs: 'nope', activeTab: 5, rail: 'evil', threadId: 4 },
      'stranger.agent': { tabs: [] }, 'a3.agent': 'junk'
    }
  };
  localStorage.setItem('k', JSON.stringify(stored));
  const state = readStudioLayout('k');
  expect(state.agents).toHaveLength(MAX_AGENTS);
  expect(state.activeAgent).toBe('b.agent');
  expect(state.workspaces['stranger.agent']).toBeUndefined();
  expect(state.workspaces['a.agent']).toMatchObject({ activeTab: 'view:graph', bottomOpen: true, bottomTab: 'trace', rail: 'assistant', threadId: 'th-1' });
  expect(state.workspaces['a.agent'].tabs.map(tab => tab.id)).toEqual(['agent:a.agent', 'view:graph']);
  // A workspace that lost its Script tab (or never had one) gets it back; junk fields fall back.
  expect(state.workspaces['b.agent']).toMatchObject({ tabs: [{ id: 'agent:b.agent', kind: 'agent' }], activeTab: 'agent:b.agent', rail: null });
  expect(state.workspaces['b.agent'].threadId).toBeUndefined();
  expect(state.workspaces['a3.agent'].tabs.map(tab => tab.id)).toEqual(['agent:a3.agent']);
  expect(state).toMatchObject({ tool: 'files', activeTab: 'agent:b.agent' });
  localStorage.setItem('k', JSON.stringify({ agents: [ref('a')], activeAgent: 'ghost.agent' }));
  expect(readStudioLayout('k').activeAgent).toBe('a.agent');
  localStorage.setItem('k', JSON.stringify({ agents: [], workspaces: { '': { tabs: [{ id: 'org-agents', kind: 'org', label: 'Org agents', target: 'agents' }] } } }));
  expect(readStudioLayout('k')).toMatchObject({ activeAgent: null, activeTab: 'org-agents' });
});

it('migrates the old flat layout into per-agent workspaces', () => {
  const agent = (name: string) => ({ id: `agent:${name}.agent`, kind: 'agent', label: name, path: `${name}.agent` });
  const apex = { id: 'apex:X', kind: 'apex', label: 'X', target: 'apex://X' };
  localStorage.setItem('k', JSON.stringify({ tool: 'release', tabs: [agent('a'), agent('b'), apex, { id: 'view:graph', kind: 'view', label: 'g', target: 'graph' }], activeTab: 'apex:X', bottomOpen: true, bottomTab: 'tests' }));
  const state = readStudioLayout('k');
  expect(state.agents.map(row => row.path)).toEqual(['a.agent', 'b.agent']);
  expect(state.activeAgent).toBe('a.agent');
  expect(state.tool).toBe('code'); // 'release' no longer exists
  expect(state).toMatchObject({ activeTab: 'apex:X', bottomOpen: true, bottomTab: 'tests' });
  expect(state.tabs.map(tab => tab.id)).toEqual(['agent:a.agent', 'apex:X']);
  expect(state.workspaces['b.agent'].tabs.map(tab => tab.id)).toEqual(['agent:b.agent']);
  localStorage.setItem('k', JSON.stringify({ tabs: [agent('a'), agent('b')], activeTab: 'agent:b.agent' }));
  expect(readStudioLayout('k').activeAgent).toBe('b.agent');
  localStorage.setItem('k', JSON.stringify({ tabs: [apex], activeTab: 'apex:X' }));
  expect(readStudioLayout('k')).toMatchObject({ activeAgent: null, tabs: [apex], activeTab: 'apex:X' });
});

const ORG_AGENTS = { id: 'org-agents', kind: 'org' as const, label: 'Org agents', target: 'agents' };
const ORG_TESTS = { id: 'org-tests', kind: 'org' as const, label: 'Tests', target: 'tests' };

it('keeps org tabs project-level: they follow every agent switch and close for all of them', () => {
  const { result } = renderHook(() => useStudioLayout('org'));
  act(() => { result.current.openAgent('a.agent', 'a'); result.current.openAgent('b.agent', 'b'); });
  act(() => result.current.openTab(ORG_AGENTS));
  act(() => result.current.openTab(ORG_TESTS));
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:b.agent', 'org-agents', 'org-tests']);
  expect(result.current.state.workspaces['b.agent'].tabs.map(tab => tab.id)).toEqual(['agent:b.agent']); // not stored per agent
  act(() => result.current.selectAgent('a.agent'));
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:a.agent', 'org-agents', 'org-tests']);
  expect(result.current.state.activeTab).toBe('agent:a.agent');
  // The active org tab is per agent, and falls back to a Script tab where it is not remembered.
  act(() => result.current.selectTab('org-tests'));
  act(() => result.current.selectAgent('b.agent'));
  expect(result.current.state.activeTab).toBe('org-tests');
  act(() => result.current.selectAgent('a.agent'));
  expect(result.current.state.activeTab).toBe('org-tests');
  act(() => result.current.closeTab('org-tests'));
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:a.agent', 'org-agents']);
  act(() => result.current.selectAgent('b.agent'));
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:b.agent', 'org-agents']);
  expect(result.current.state.activeTab).toBe('agent:b.agent'); // org-tests was closed
  act(() => result.current.closeAgent('b.agent'));
  expect(result.current.state.tabs.map(tab => tab.id)).toEqual(['agent:a.agent', 'org-agents']);
  // They also survive a reload.
  expect(readStudioLayout('salesforce:studio:org').orgTabs).toEqual([ORG_AGENTS]);
});

it('hoists org tabs stored per workspace by earlier layouts', () => {
  const script = (n: string) => ({ id: `agent:${n}.agent`, kind: 'agent', label: n, path: `${n}.agent` });
  localStorage.setItem('k', JSON.stringify({
    agents: [{ path: 'a.agent', label: 'a' }, { path: 'b.agent', label: 'b' }], activeAgent: 'b.agent',
    workspaces: { 'a.agent': { tabs: [script('a'), ORG_AGENTS], activeTab: 'org-agents' }, 'b.agent': { tabs: [script('b'), ORG_AGENTS, ORG_TESTS] } }
  }));
  const state = readStudioLayout('k');
  expect(state.orgTabs.map(tab => tab.id)).toEqual(['org-agents', 'org-tests']);
  expect(state.workspaces['a.agent'].tabs.map(tab => tab.id)).toEqual(['agent:a.agent']);
  expect(state.tabs.map(tab => tab.id)).toEqual(['agent:b.agent', 'org-agents', 'org-tests']);
  expect(state.workspaces['a.agent'].activeTab).toBe('org-agents');
  // A flat layout's org tab moves to the project level too; a stored `orgTabs` list only keeps org tabs.
  localStorage.setItem('k', JSON.stringify({ tabs: [script('a'), ORG_TESTS], activeTab: 'org-tests', orgTabs: [ORG_AGENTS, { id: 'apex:X', kind: 'apex', label: 'X', target: 'apex://X' }] }));
  const flat = readStudioLayout('k');
  expect(flat.orgTabs.map(tab => tab.id)).toEqual(['org-agents', 'org-tests']);
  expect(flat).toMatchObject({ activeTab: 'org-tests' });
});

it('seeds an unseen scope from the fallback scope, then keeps its own key', () => {
  const { result: tab } = renderHook(() => useStudioLayout('proj'));
  act(() => tab.current.openAgent('a.agent', 'a'));
  const { result: win } = renderHook(() => useStudioLayout('proj|window', 'proj'));
  expect(win.current.state.agents.map(agent => agent.path)).toEqual(['a.agent']);
  act(() => win.current.openAgent('b.agent', 'b'));
  expect(JSON.parse(localStorage.getItem('salesforce:studio:proj|window')!).agents).toHaveLength(2);
  expect(JSON.parse(localStorage.getItem('salesforce:studio:proj')!).agents).toHaveLength(1); // the tab's layout is untouched
  // once the window has its own layout the fallback is no longer read
  const { result: again } = renderHook(() => useStudioLayout('proj|window', 'proj'));
  expect(again.current.state.agents).toHaveLength(2);
  // a fallback equal to the scope, or without a stored layout, adds nothing
  const { result: same } = renderHook(() => useStudioLayout('fresh', 'fresh'));
  expect(same.current.state.agents).toEqual([]);
  const { result: none } = renderHook(() => useStudioLayout('fresh2', 'missing'));
  expect(none.current.state.agents).toEqual([]);
});
