import { useCallback, useEffect, useState } from 'react';
import { AGENT_SCRIPT_TOOLS, type AgentScriptTool } from '../AgentScriptTools.js';
import { isBottomTab, type BottomTab } from './BottomPanel.js';

export type CompactTool = 'code' | AgentScriptTool;
export const VIEW_TARGETS = ['preview', 'tests', 'graph', 'org-preview'] as const;
export type ViewTarget = typeof VIEW_TARGETS[number];
export const isViewTarget = (value: unknown): value is ViewTarget => VIEW_TARGETS.includes(value as ViewTarget);
export type RailTab = 'assistant' | 'actions' | 'comments' | 'preview' | 'test' | 'graph' | 'org-preview';
/**
 * `agent` is an agent's Script tab, `view` one of its Preview / Tests / Graph / Org preview views (one per kind),
 * `org` the Org agents browser: beside a host side panel it opens here instead of as a panel tool.
 */
export interface EditorTab { id: string; kind: 'agent' | 'apex' | 'flow' | 'type' | 'lwc' | 'org' | 'view'; label: string; path?: string; target?: string }
export interface AgentRef { path: string; label: string }
/** What one open agent remembers: its tabs, bottom panel, host rail tab and the Assistant thread. */
export interface Workspace { tabs: EditorTab[]; activeTab: string | null; bottomOpen: boolean; bottomTab: BottomTab; rail: RailTab | null; threadId?: string; panelViews?: ViewTarget[] }
export interface StudioLayoutState {
  /** Compact mode shows exactly one tool; wide mode ignores it. */
  tool: CompactTool;
  agents: AgentRef[];
  activeAgent: string | null;
  /** Keyed by agent path; `''` holds the tabs open while no agent is. Pruned together with `agents`. */
  workspaces: Record<string, Workspace>;
  /** Project-level `org` tabs (Org agents, Org tests): shown in every workspace's tab strip, never stored per agent. */
  orgTabs: EditorTab[];
  /** The fields below mirror the active workspace (its tabs followed by `orgTabs`). */
  tabs: EditorTab[];
  activeTab: string | null;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  rail: RailTab | null;
  threadId?: string;
  explorerOpen: boolean;
  /** Explorer column width in px (wide layout), or null for the default. */
  explorerWidth: number | null;
  /** Explorer sections the user folded (`project`, `apex`, `lightning-type`, …). A filter query shows them all. */
  collapsedSections: string[];
  share: boolean;
  /** The right rail gets Assistant once, the first time the wide layout is shown. */
  railSeeded: boolean;
  /** Last Project / Org source chosen on a Flow or Apex view; every implementation view opens on it. */
  actionOrigin: 'project' | 'org';
}
export const MAX_EDITOR_TABS = 12;
export const MAX_AGENTS = 12;
export const NO_AGENT = '';
export const EXPLORER_WIDTH = { min: 200, max: 480, default: 260 } as const;
export const clampExplorerWidth = (value: number) => Math.round(Math.min(EXPLORER_WIDTH.max, Math.max(EXPLORER_WIDTH.min, value)));

export const scriptTabId = (path: string) => `agent:${path}`;
export const viewTabId = (target: ViewTarget) => `view:${target}`;
export const VIEW_LABEL: Record<ViewTarget, string> = { preview: 'Preview', tests: 'Tests', graph: 'Graph', 'org-preview': 'Org preview' };
export const scriptTab = (ref: AgentRef): EditorTab => ({ id: scriptTabId(ref.path), kind: 'agent', label: ref.label, path: ref.path });
export const viewTab = (target: ViewTarget): EditorTab => ({ id: viewTabId(target), kind: 'view', label: VIEW_LABEL[target], target });
export const emptyWorkspace = (): Workspace => ({ tabs: [], activeTab: null, bottomOpen: false, bottomTab: 'problems', rail: null });

/** Evict the oldest other tabs; Script and the requested view survive opening or restoring an agent. */
function capTabs(tabs: EditorTab[], activeTab: string | null, scriptId?: string): EditorTab[] {
  if (tabs.length <= MAX_EDITOR_TABS) return tabs;
  const dropped = new Set(tabs.filter(tab => tab.id !== activeTab && tab.id !== scriptId)
    .slice(0, tabs.length - MAX_EDITOR_TABS).map(tab => tab.id));
  return tabs.filter(tab => !dropped.has(tab.id));
}

const GLOBAL_DEFAULTS = { orgTabs: [] as EditorTab[], tool: 'code' as CompactTool, explorerOpen: true, explorerWidth: null, collapsedSections: [] as string[], share: false, railSeeded: false, actionOrigin: 'project' as const };

/** Mirrors the active workspace into the flat fields the components read. */
function derive(base: Omit<StudioLayoutState, 'tabs' | 'activeTab' | 'bottomOpen' | 'bottomTab' | 'rail' | 'threadId'>): StudioLayoutState {
  const ws = base.workspaces[base.activeAgent ?? NO_AGENT] ?? emptyWorkspace();
  const tabs = base.orgTabs.length ? [...ws.tabs, ...base.orgTabs] : ws.tabs;
  const activeTab = ws.activeTab === null || tabs.some(tab => tab.id === ws.activeTab) ? ws.activeTab : tabs[0]?.id ?? null;
  return { ...base, tabs, activeTab, bottomOpen: ws.bottomOpen, bottomTab: ws.bottomTab, rail: ws.rail, ...(ws.threadId ? { threadId: ws.threadId } : {}) };
}
export const DEFAULT_LAYOUT: StudioLayoutState = derive({ ...GLOBAL_DEFAULTS, agents: [], activeAgent: null, workspaces: {} });

const text = (value: unknown, max = 300) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
export function parseTab(value: unknown): EditorTab | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind === 'agent' || row.kind === 'apex' || row.kind === 'flow' || row.kind === 'type' || row.kind === 'lwc' || row.kind === 'org' || row.kind === 'view' ? row.kind : null;
  const id = text(row.id); const label = text(row.label, 160);
  if (!kind || !id || !label) return null;
  const path = text(row.path); const target = text(row.target);
  if (kind === 'agent' && !path) return null;
  if (kind === 'view' && !isViewTarget(target)) return null;
  if (kind !== 'agent' && !target) return null;
  return { id, kind, label, ...(path ? { path } : {}), ...(target ? { target } : {}) };
}

function parseTabs(value: unknown): EditorTab[] {
  const tabs: EditorTab[] = [];
  for (const item of Array.isArray(value) ? value.slice(0, MAX_EDITOR_TABS) : []) {
    const tab = parseTab(item);
    if (tab && !tabs.some(row => row.id === tab.id)) tabs.push(tab);
  }
  return tabs;
}
const parseRail = (value: unknown): RailTab | null => value === 'assistant' || value === 'actions' || value === 'comments' || value === 'preview' || value === 'test' || value === 'graph' || value === 'org-preview' ? value : null;
export const viewRail = (target: ViewTarget): RailTab => target === 'tests' ? 'test' : target;

function parseWorkspace(value: unknown): Workspace {
  if (!value || typeof value !== 'object') return emptyWorkspace();
  const raw = value as Record<string, unknown>;
  const tabs = parseTabs(raw.tabs);
  const threadId = text(raw.threadId, 200);
  const panelViews = Array.isArray(raw.panelViews) ? [...new Set(raw.panelViews.filter(isViewTarget))] : [];
  return {
    tabs, activeTab: tabs.some(tab => tab.id === raw.activeTab) || (typeof raw.activeTab === 'string' && raw.activeTab.startsWith('org-')) ? raw.activeTab as string : tabs[0]?.id ?? null,
    bottomOpen: raw.bottomOpen === true, bottomTab: isBottomTab(raw.bottomTab) ? raw.bottomTab : 'problems', rail: parseRail(raw.rail),
    ...(threadId ? { threadId } : {}), ...(panelViews.length ? { panelViews } : {})
  };
}

function parseAgents(value: unknown): AgentRef[] {
  const agents: AgentRef[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const path = text(row.path); const label = text(row.label, 160);
    if (path && label && !agents.some(agent => agent.path === path)) agents.push({ path, label });
    if (agents.length >= MAX_AGENTS) break;
  }
  return agents;
}

/** Old layouts kept one flat tab strip: every agent tab becomes its own workspace, the rest join the active one. */
function migrateFlat(raw: Record<string, unknown>): { agents: AgentRef[]; activeAgent: string | null; workspaces: Record<string, Workspace> } {
  const tabs = parseTabs(raw.tabs);
  const agents: AgentRef[] = tabs.filter(tab => tab.kind === 'agent').map(tab => ({ path: tab.path!, label: tab.label }));
  const activeRow = tabs.find(tab => tab.id === raw.activeTab);
  const activeAgent = activeRow?.kind === 'agent' ? activeRow.path! : agents[0]?.path ?? null;
  const workspaces: Record<string, Workspace> = {};
  for (const agent of agents) workspaces[agent.path] = { ...emptyWorkspace(), tabs: [scriptTab(agent)], activeTab: scriptTabId(agent.path) };
  const home = workspaces[activeAgent ?? NO_AGENT] ?? (workspaces[NO_AGENT] = emptyWorkspace());
  for (const tab of tabs) if (tab.kind !== 'agent' && tab.kind !== 'view') home.tabs.push(tab);
  if (activeRow && activeRow.kind !== 'agent' && home.tabs.some(tab => tab.id === activeRow.id)) home.activeTab = activeRow.id;
  else home.activeTab ??= home.tabs[0]?.id ?? null;
  home.bottomOpen = raw.bottomOpen === true;
  home.bottomTab = isBottomTab(raw.bottomTab) ? raw.bottomTab : 'problems';
  if (!home.tabs.length && !home.bottomOpen && home.bottomTab === 'problems' && !agents.length) delete workspaces[NO_AGENT];
  return { agents, activeAgent, workspaces };
}

const isOrgTab = (tab: EditorTab) => tab.kind === 'org';
/** Moves every `org` tab out of the workspaces (older layouts stored them per agent) into one project-level list. */
function hoistOrgTabs(workspaces: Record<string, Workspace>, extra: EditorTab[] = []): EditorTab[] {
  const orgTabs: EditorTab[] = [];
  for (const tab of [...extra, ...Object.values(workspaces).flatMap(ws => ws.tabs.filter(isOrgTab))]) if (!orgTabs.some(row => row.id === tab.id)) orgTabs.push(tab);
  for (const ws of Object.values(workspaces)) ws.tabs = ws.tabs.filter(tab => !isOrgTab(tab));
  return orgTabs.slice(0, MAX_EDITOR_TABS);
}

export function readStudioLayout(key: string): StudioLayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_LAYOUT;
    const { agents, activeAgent, workspaces } = ((): { agents: AgentRef[]; activeAgent: string | null; workspaces: Record<string, Workspace> } => {
      if (!Array.isArray(raw.agents)) return migrateFlat(raw);
      const agents = parseAgents(raw.agents);
      const stored = raw.workspaces && typeof raw.workspaces === 'object' ? raw.workspaces as Record<string, unknown> : {};
      const workspaces: Record<string, Workspace> = {};
      for (const key of [...agents.map(agent => agent.path), NO_AGENT]) if (Object.prototype.hasOwnProperty.call(stored, key)) workspaces[key] = parseWorkspace(stored[key]);
      return { agents, activeAgent: typeof raw.activeAgent === 'string' && agents.some(agent => agent.path === raw.activeAgent) ? raw.activeAgent : agents[0]?.path ?? null, workspaces };
    })();
    const orgTabs = hoistOrgTabs(workspaces, parseTabs(raw.orgTabs).filter(isOrgTab));
    for (const agent of agents) { // every open agent keeps its Script tab
      const ws = workspaces[agent.path] ??= emptyWorkspace();
      if (!ws.tabs.some(tab => tab.id === scriptTabId(agent.path))) { ws.tabs = capTabs([scriptTab(agent), ...ws.tabs], ws.activeTab, scriptTabId(agent.path)); ws.activeTab ??= scriptTabId(agent.path); }
    }
    return derive({
      tool: raw.tool === 'code' || AGENT_SCRIPT_TOOLS.some(tool => tool.id === raw.tool) ? raw.tool : 'code',
      agents, activeAgent, workspaces, orgTabs,
      explorerOpen: raw.explorerOpen !== false,
      explorerWidth: typeof raw.explorerWidth === 'number' && Number.isFinite(raw.explorerWidth) ? clampExplorerWidth(raw.explorerWidth) : null,
      collapsedSections: Array.isArray(raw.collapsedSections) ? [...new Set<string>((raw.collapsedSections as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 40))].slice(0, 20) : [],
      share: raw.share === true,
      railSeeded: raw.railSeeded === true,
      actionOrigin: raw.actionOrigin === 'org' ? 'org' : 'project'
    });
  } catch { return DEFAULT_LAYOUT; }
}

/**
 * Closes `ids`. `focus` becomes active when it stays open; otherwise a closed active tab hands over to
 * the nearest open tab on its left (then its right).
 */
export function withoutTabs<T extends { tabs: EditorTab[]; activeTab: string | null }>(state: T, ids: string[], focus?: string): T {
  const closing = new Set(ids);
  if (!state.tabs.some(tab => closing.has(tab.id))) return state;
  const tabs = state.tabs.filter(tab => !closing.has(tab.id));
  let activeTab = state.activeTab;
  if (focus && tabs.some(tab => tab.id === focus)) activeTab = focus;
  else if (activeTab && closing.has(activeTab)) {
    const index = state.tabs.findIndex(tab => tab.id === activeTab);
    activeTab = state.tabs.slice(0, index).reverse().find(tab => !closing.has(tab.id))?.id ?? tabs[0]?.id ?? null;
  }
  return { ...state, tabs, activeTab };
}

const WORKSPACE_FIELDS = ['tabs', 'activeTab', 'bottomOpen', 'bottomTab', 'rail', 'threadId'] as const;
const activeKey = (state: StudioLayoutState) => state.activeAgent ?? NO_AGENT;

/** Applies `change` to one workspace and re-derives the flat fields. Workspaces of agents that are not open are dropped. */
export function withWorkspace(state: StudioLayoutState, key: string, change: (ws: Workspace) => Workspace): StudioLayoutState {
  if (key !== NO_AGENT && !state.agents.some(agent => agent.path === key)) return state;
  const { tabs: _t, activeTab: _a, bottomOpen: _o, bottomTab: _b, rail: _r, threadId: _i, ...rest } = state;
  // `change` sees the workspace's tabs followed by the project-level org tabs; org tabs it keeps or adds stay project-level.
  const current = state.workspaces[key] ?? emptyWorkspace();
  const next = change({ ...current, tabs: [...current.tabs, ...state.orgTabs] });
  const orgTabs = next.tabs.filter(isOrgTab);
  return derive({ ...rest, orgTabs, workspaces: { ...state.workspaces, [key]: { ...next, tabs: next.tabs.filter(tab => !isOrgTab(tab)) } } });
}

/** Opens (or focuses) an agent. The oldest inactive agent makes room beyond the cap. */
export function withAgent(state: StudioLayoutState, ref: AgentRef): StudioLayoutState {
  const { tabs: _t, activeTab: _a, bottomOpen: _o, bottomTab: _b, rail: _r, threadId: _i, ...rest } = state;
  let agents = state.agents.some(agent => agent.path === ref.path) ? state.agents.map(agent => agent.path === ref.path ? ref : agent) : [...state.agents, ref];
  const workspaces = { ...state.workspaces };
  while (agents.length > MAX_AGENTS) {
    const drop = agents.find(agent => agent.path !== ref.path)!;
    agents = agents.filter(agent => agent !== drop); delete workspaces[drop.path];
  }
  const ws = workspaces[ref.path] ?? emptyWorkspace();
  const script = scriptTab(ref);
  workspaces[ref.path] = ws.tabs.some(tab => tab.id === script.id) ? { ...ws, tabs: ws.tabs.map(tab => tab.id === script.id ? script : tab) } : { ...ws, tabs: capTabs([script, ...ws.tabs], ws.activeTab, script.id), activeTab: ws.activeTab ?? script.id };
  return derive({ ...rest, agents, activeAgent: ref.path, workspaces });
}

export function withActiveAgent(state: StudioLayoutState, path: string): StudioLayoutState {
  if (state.activeAgent === path || !state.agents.some(agent => agent.path === path)) return state;
  const { tabs: _t, activeTab: _a, bottomOpen: _o, bottomTab: _b, rail: _r, threadId: _i, ...rest } = state;
  return derive({ ...rest, activeAgent: path });
}

/** Move saved editor views into the host panel without using document-tab capacity. */
export function dockStudioViews(state: StudioLayoutState): StudioLayoutState {
  let next = state;
  for (const agent of state.agents) {
    const ws = next.workspaces[agent.path];
    const views = ws?.tabs.filter(tab => tab.kind === 'view' && isViewTarget(tab.target)) ?? [];
    if (!ws || !views.length) continue;
    const selected = views.find(tab => tab.id === ws.activeTab);
    next = withWorkspace(next, agent.path, current => ({
      ...current, tabs: current.tabs.filter(tab => tab.kind !== 'view'),
      panelViews: [...new Set([...(current.panelViews ?? []), ...views.map(tab => tab.target as ViewTarget)])],
      activeTab: selected ? scriptTabId(agent.path) : current.activeTab,
      rail: selected ? viewRail(selected.target as ViewTarget) : current.rail,
    }));
  }
  return next;
}

/** Closes an agent; the right neighbour becomes active, else the left one. */
export function withoutAgent(state: StudioLayoutState, path: string): StudioLayoutState {
  const index = state.agents.findIndex(agent => agent.path === path);
  if (index < 0) return state;
  const { tabs: _t, activeTab: _a, bottomOpen: _o, bottomTab: _b, rail: _r, threadId: _i, ...rest } = state;
  const agents = state.agents.filter(agent => agent.path !== path);
  const workspaces = { ...state.workspaces }; delete workspaces[path];
  const activeAgent = state.activeAgent === path ? (state.agents[index + 1] ?? state.agents[index - 1])?.path ?? null : state.activeAgent;
  return derive({ ...rest, agents, activeAgent, workspaces });
}

/**
 * Per-project Studio layout (one key per project and surface, never per thread). Only layout is persisted; editor drafts have their own store.
 * `fallbackScope` seeds a scope with no stored layout yet from another one (the Studio window starts from the project tab's).
 */
export function useStudioLayout(scope: string, fallbackScope?: string) {
  const key = `salesforce:studio:${scope}`;
  const fallbackKey = fallbackScope && fallbackScope !== scope ? `salesforce:studio:${fallbackScope}` : null;
  const load = (target: string) => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(target); } catch { /* optional */ }
    return readStudioLayout(stored === null && fallbackKey ? fallbackKey : target);
  };
  const [state, setState] = useState(() => load(key));
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) { setLoadedKey(key); setState(load(key)); } // another project: never write this layout under its key
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* optional */ } }, [key, state]);
  /** Workspace fields land in the active workspace, everything else is global. */
  const patch = useCallback((next: Partial<StudioLayoutState>) => setState(current => {
    const mine: Partial<Workspace> = {}; const rest: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(next)) (WORKSPACE_FIELDS as readonly string[]).includes(name) ? (mine as Record<string, unknown>)[name] = value : rest[name] = value;
    const globals = { ...current, ...rest } as StudioLayoutState;
    return Object.keys(mine).length ? withWorkspace(globals, activeKey(current), ws => ({ ...ws, ...mine })) : globals;
  }), []);
  const patchWorkspace = useCallback((path: string, next: Partial<Workspace>) => setState(current => withWorkspace(current, path, ws => ({ ...ws, ...next }))), []);
  const openTab = useCallback((tab: EditorTab) => setState(current => withWorkspace(current, activeKey(current), ws => {
    const tabs = ws.tabs.some(row => row.id === tab.id) ? ws.tabs.map(row => row.id === tab.id ? tab : row) : capTabs([...ws.tabs, tab], tab.id, current.activeAgent ? scriptTabId(current.activeAgent) : undefined);
    return { ...ws, tabs, activeTab: tab.id };
  })), []);
  const selectTab = useCallback((id: string) => setState(current => withWorkspace(current, activeKey(current), ws => ws.tabs.some(tab => tab.id === id) ? { ...ws, activeTab: id } : ws)), []);
  const closeTabs = useCallback((ids: string[], focus?: string) => setState(current => withWorkspace(current, activeKey(current), ws => withoutTabs(ws, ids, focus))), []);
  const closeTab = useCallback((id: string) => closeTabs([id]), [closeTabs]);
  const openAgent = useCallback((path: string, label: string) => setState(current => withAgent(current, { path, label })), []);
  const openPanelView = useCallback((target: ViewTarget) => setState(current => current.activeAgent ? withWorkspace(current, current.activeAgent, ws => ({
    ...ws, panelViews: [...new Set([...(ws.panelViews ?? []), target])], rail: viewRail(target),
  })) : current), []);
  const dockViews = useCallback(() => setState(dockStudioViews), []);
  const selectAgent = useCallback((path: string) => setState(current => withActiveAgent(current, path)), []);
  const closeAgent = useCallback((path: string) => setState(current => withoutAgent(current, path)), []);
  return { state, patch, patchWorkspace, openTab, selectTab, closeTab, closeTabs, openAgent, selectAgent, closeAgent, openPanelView, dockViews };
}
