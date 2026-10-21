/**
 * The side panel beside a plugin page (`PluginPanelHostLayout`): which page it
 * belongs to, and `navigate.openPanelTool` requests for that page's
 * `'plugin-page'` thread-panel actions. With no layout listening the request
 * reports false, so the page keeps its own fallback.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import { threadPanelActionMatchesScope, type PluginThreadPanelPage } from '@zana-ai/zcc-plugin-sdk';
import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { listThreadPanelActions } from './plugin-slots.js';

export const PLUGIN_PANEL_TOOL_EVENT = 'zcc:plugin-panel-tool-open';

/** Side-panel owner ids of plugin pages start with this; thread and agent-session ids never do. */
export const PLUGIN_PAGE_PANEL_OWNER_PREFIX = 'plugin-panel:';

/** Bounds a tab label a page can set; the action's own title is used when absent. */
export const PANEL_TOOL_TITLE_MAX_LENGTH = 120;

export interface PanelToolTarget {
  actionId: string;
  title: string;
  params: JsonValue | null;
  layout?: 'padded' | 'flush';
}

interface PluginPanelToolRequest {
  pluginId: string;
  options: unknown;
  /** The layout enclosing the asking page; only that one answers (split panes each have their own). */
  page?: PluginThreadPanelPage;
  /** Set by the layout that opened the tool. */
  handled: boolean;
}

const PluginPagePanelContext = createContext<PluginThreadPanelPage | null>(null);
const PluginPagePanelOpenContext = createContext<boolean | undefined>(undefined);

/**
 * Marks a plugin page as sitting beside a host side panel (`useZccContext().sidePanel`);
 * `open` is whether that panel is showing (`useZccContext().sidePanelOpen`).
 */
export function PluginPagePanelProvider({ page, open, children }: { page: PluginThreadPanelPage; open?: boolean; children: ReactNode }) {
  return createElement(PluginPagePanelContext.Provider, { value: page },
    createElement(PluginPagePanelOpenContext.Provider, { value: open }, children));
}

/** The page whose side panel encloses the caller, or null outside one. */
export function usePluginPagePanel(): PluginThreadPanelPage | null {
  return useContext(PluginPagePanelContext);
}

/** Whether the enclosing side panel is showing; undefined when the layout does not say. */
export function usePluginPagePanelOpen(): boolean | undefined {
  return useContext(PluginPagePanelOpenContext);
}

function jsonParams(value: unknown): JsonValue | null | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return undefined;
  }
}

/**
 * Plugin input is untrusted: only a registered action of this page's owner
 * that lists `'plugin-page'` (and this page, when it names pages) opens.
 */
export function resolvePanelToolTarget(page: PluginThreadPanelPage, options: unknown): PanelToolTarget | null {
  if (!options || typeof options !== 'object') return null;
  const raw = options as { actionId?: unknown; title?: unknown; params?: unknown };
  if (typeof raw.actionId !== 'string' || !raw.actionId) return null;
  const action = listThreadPanelActions().find((row) => row.pluginId === page.pluginId && row.id === raw.actionId);
  if (!action || !threadPanelActionMatchesScope(action, 'plugin-page', page)) return null;
  const params = jsonParams(raw.params);
  if (raw.params !== undefined && params === undefined) return null;
  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim().slice(0, PANEL_TOOL_TITLE_MAX_LENGTH)
    : action.title;
  return {
    actionId: action.id,
    title,
    params: params ?? null,
    ...(action.layout ? { layout: action.layout } : {})
  };
}

export function requestPluginPanelTool(pluginId: string, options: unknown, page?: PluginThreadPanelPage): boolean {
  const detail: PluginPanelToolRequest = { pluginId, options, handled: false, ...(page ? { page } : {}) };
  window.dispatchEvent(new CustomEvent(PLUGIN_PANEL_TOOL_EVENT, { detail }));
  return detail.handled;
}

/** Subscribe a plugin page's layout; returns the unsubscribe. */
export function onPluginPanelToolRequest(
  page: PluginThreadPanelPage,
  show: (target: PanelToolTarget) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PluginPanelToolRequest>).detail;
    if (!detail || detail.handled || detail.pluginId !== page.pluginId) return;
    if (detail.page && detail.page !== page) return;
    const target = resolvePanelToolTarget(page, detail.options);
    if (!target) return;
    detail.handled = true;
    show(target);
  };
  window.addEventListener(PLUGIN_PANEL_TOOL_EVENT, listener);
  return () => window.removeEventListener(PLUGIN_PANEL_TOOL_EVENT, listener);
}
