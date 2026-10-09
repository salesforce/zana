import { useCallback, useEffect, useState } from 'react';
import { AGENT_SCRIPT_TOOLS, type AgentScriptTool } from '../AgentScriptTools.js';
import { isBottomTab, type BottomTab } from './BottomPanel.js';

export type CompactTool = 'code' | AgentScriptTool;
export interface EditorTab { id: string; kind: 'agent' | 'apex' | 'flow'; label: string; path?: string; target?: string }
export interface StudioLayoutState {
  /** Compact mode shows exactly one tool; wide mode ignores it. */
  tool: CompactTool;
  tabs: EditorTab[];
  activeTab: string | null;
  bottomOpen: boolean;
  bottomTab: BottomTab;
  explorerOpen: boolean;
  share: boolean;
  /** The right rail gets Assistant once, the first time the wide layout is shown. */
  railSeeded: boolean;
}
export const MAX_EDITOR_TABS = 12;
export const DEFAULT_LAYOUT: StudioLayoutState = { tool: 'code', tabs: [], activeTab: null, bottomOpen: false, bottomTab: 'problems', explorerOpen: true, share: false, railSeeded: false };

const text = (value: unknown, max = 300) => typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined;
export function parseTab(value: unknown): EditorTab | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind === 'agent' || row.kind === 'apex' || row.kind === 'flow' ? row.kind : null;
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
      share: raw.share === true,
      railSeeded: raw.railSeeded === true
    };
  } catch { return DEFAULT_LAYOUT; }
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
  const closeTab = useCallback((id: string) => setState(current => {
    const index = current.tabs.findIndex(tab => tab.id === id);
    if (index < 0) return current;
    const tabs = current.tabs.filter(tab => tab.id !== id);
    return { ...current, tabs, activeTab: current.activeTab === id ? tabs[Math.max(0, index - 1)]?.id ?? null : current.activeTab };
  }), []);
  return { state, patch, openTab, selectTab, closeTab };
}
