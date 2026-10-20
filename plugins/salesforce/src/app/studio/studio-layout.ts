import { useCallback, useEffect, useState } from 'react';
import { AGENT_SCRIPT_TOOLS, type AgentScriptTool } from '../AgentScriptTools.js';
import { isBottomTab, type BottomTab } from './BottomPanel.js';

export type CompactTool = 'code' | AgentScriptTool;
/** `org` is the Org agents browser: beside a host side panel it opens here instead of as a panel tool. */
export interface EditorTab { id: string; kind: 'agent' | 'apex' | 'flow' | 'type' | 'org'; label: string; path?: string; target?: string }
export interface StudioLayoutState {
  /** Compact mode shows exactly one tool; wide mode ignores it. */
  tool: CompactTool;
  tabs: EditorTab[];
  activeTab: string | null;
  bottomOpen: boolean;
  bottomTab: BottomTab;
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
export const EXPLORER_WIDTH = { min: 200, max: 480, default: 260 } as const;
export const clampExplorerWidth = (value: number) => Math.round(Math.min(EXPLORER_WIDTH.max, Math.max(EXPLORER_WIDTH.min, value)));
export const DEFAULT_LAYOUT: StudioLayoutState = { tool: 'code', tabs: [], activeTab: null, bottomOpen: false, bottomTab: 'problems', explorerOpen: true, explorerWidth: null, collapsedSections: [], share: false, railSeeded: false, actionOrigin: 'project' };

const text = (value: unknown, max = 300) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
export function parseTab(value: unknown): EditorTab | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind === 'agent' || row.kind === 'apex' || row.kind === 'flow' || row.kind === 'type' || row.kind === 'org' ? row.kind : null;
  const id = text(row.id); const label = text(row.label, 160);
  if (!kind || !id || !label) return null;
  const path = text(row.path); const target = text(row.target);
  if (kind === 'agent' && !path) return null;
  if (kind !== 'agent' && !target) return null;
  return { id, kind, label, ...(path ? { path } : {}), ...(target ? { target } : {}) };
}

export function readStudioLayout(key: string): StudioLayoutState {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null');
    if (!raw || typeof raw !== 'object') return DEFAULT_LAYOUT;
    const tabs: EditorTab[] = [];
    for (const item of Array.isArray(raw.tabs) ? raw.tabs.slice(0, MAX_EDITOR_TABS) : []) {
      const tab = parseTab(item);
      if (tab && !tabs.some(row => row.id === tab.id)) tabs.push(tab);
    }
    return {
      tool: raw.tool === 'code' || AGENT_SCRIPT_TOOLS.some(tool => tool.id === raw.tool) ? raw.tool : 'code',
      tabs,
      activeTab: tabs.some(tab => tab.id === raw.activeTab) ? raw.activeTab : tabs[0]?.id ?? null,
      bottomOpen: raw.bottomOpen === true,
      bottomTab: isBottomTab(raw.bottomTab) ? raw.bottomTab : 'problems',
      explorerOpen: raw.explorerOpen !== false,
      explorerWidth: typeof raw.explorerWidth === 'number' && Number.isFinite(raw.explorerWidth) ? clampExplorerWidth(raw.explorerWidth) : null,
      collapsedSections: Array.isArray(raw.collapsedSections) ? [...new Set<string>((raw.collapsedSections as unknown[]).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 40))].slice(0, 20) : [],
      share: raw.share === true,
      railSeeded: raw.railSeeded === true,
      actionOrigin: raw.actionOrigin === 'org' ? 'org' : 'project'
    };
  } catch { return DEFAULT_LAYOUT; }
}

/**
 * Closes `ids`. `focus` becomes active when it stays open; otherwise a closed active tab hands over to
 * the nearest open tab on its left (then its right).
 */
export function withoutTabs(state: StudioLayoutState, ids: string[], focus?: string): StudioLayoutState {
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

/** Per-project Studio layout. Only layout is persisted; editor drafts have their own store. */
export function useStudioLayout(scope: string) {
  const key = `salesforce:studio:${scope}`;
  const [state, setState] = useState(() => readStudioLayout(key));
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) { setLoadedKey(key); setState(readStudioLayout(key)); } // another project: never write this layout under its key
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* optional */ } }, [key, state]);
  const patch = useCallback((next: Partial<StudioLayoutState>) => setState(current => ({ ...current, ...next })), []);
  const openTab = useCallback((tab: EditorTab) => setState(current => {
    const tabs = current.tabs.some(row => row.id === tab.id) ? current.tabs.map(row => row.id === tab.id ? tab : row) : [...current.tabs.slice(-(MAX_EDITOR_TABS - 1)), tab];
    return { ...current, tabs, activeTab: tab.id };
  }), []);
  const selectTab = useCallback((id: string) => setState(current => current.tabs.some(tab => tab.id === id) ? { ...current, activeTab: id } : current), []);
  const closeTabs = useCallback((ids: string[], focus?: string) => setState(current => withoutTabs(current, ids, focus)), []);
  const closeTab = useCallback((id: string) => closeTabs([id]), [closeTabs]);
  return { state, patch, openTab, selectTab, closeTab, closeTabs };
}
