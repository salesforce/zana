/**
 * Studio tools shown in the host side panel beside the Salesforce page (the Assistant rail's
 * Actions and Comments; the other tools are Studio view tabs).
 *
 * Each tool keeps one DOM node per project. Studio renders the tool into that
 * node through a portal, so its state (preview conversation, test results,
 * graph focus) stays in Studio. The host tab (`studio-<tool>` thread-panel
 * action, `'plugin-page'` scope) only adopts the node while it is shown. A
 * host tab that is switched away or closed hands the node back; the tool keeps
 * running detached until Studio itself unmounts. A tool shown in a different
 * tab (closed, then opened again) starts fresh: Studio keys it by `tabId`.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export const PANEL_TOOLS = ['actions', 'comments'] as const;
export type PanelTool = typeof PANEL_TOOLS[number];
export const isPanelTool = (value: unknown): value is PanelTool => PANEL_TOOLS.includes(value as PanelTool);
export const panelToolActionId = (tool: PanelTool) => `studio-${tool}`;

export interface StudioToolSlot {
  tool: PanelTool;
  node: HTMLElement;
  /** True while a host tab shows the node. */
  attached: boolean;
  /** The host tab that last showed the node (`PluginThreadPanelProps.tabId`). */
  tabId?: string;
}

interface Scope {
  studios: number;
  slots: Map<PanelTool, StudioToolSlot>;
  snapshot: readonly StudioToolSlot[];
  listeners: Set<() => void>;
}

const EMPTY: readonly StudioToolSlot[] = [];
const scopes = new Map<string, Scope>();

function scopeFor(key: string): Scope {
  let scope = scopes.get(key);
  if (!scope) {
    scope = { studios: 0, slots: new Map(), snapshot: EMPTY, listeners: new Set() };
    scopes.set(key, scope);
  }
  return scope;
}

/** Nothing left to keep: no Studio renders here, nobody listens and no host tab shows a node. */
function prune(key: string, scope: Scope) {
  if (scope.studios === 0 && scope.listeners.size === 0 && ![...scope.slots.values()].some(slot => slot.attached) && scopes.get(key) === scope) scopes.delete(key);
}

function changed(key: string, scope: Scope) {
  scope.snapshot = PANEL_TOOLS.flatMap(tool => {
    const slot = scope.slots.get(tool);
    return slot ? [{ ...slot }] : [];
  });
  for (const listener of [...scope.listeners]) listener();
  prune(key, scope);
}

function slotFor(scope: Scope, tool: PanelTool): StudioToolSlot {
  let slot = scope.slots.get(tool);
  if (!slot) {
    const node = document.createElement('div');
    // `sf-as` carries the --sf-* tokens and Studio's scoped rules into the host panel.
    node.className = 'sf-as af-tools sf-panel-tool';
    node.dataset.studioTool = tool;
    node.style.cssText = 'flex:1 1 auto;min-height:0;min-width:0;height:100%;';
    slot = { tool, node, attached: false };
    scope.slots.set(tool, slot);
  }
  return slot;
}

/** A host tab shows `tool`'s node in `container`; returns the hand-back. */
export function attachStudioTool(key: string, tool: PanelTool, container: HTMLElement, tabId?: string): () => void {
  const scope = scopeFor(key);
  const slot = slotFor(scope, tool);
  container.appendChild(slot.node);
  slot.attached = true;
  if (tabId) slot.tabId = tabId;
  changed(key, scope);
  return () => {
    if (slot.node.parentElement === container) container.removeChild(slot.node);
    // A newer tab may have adopted the node already.
    if (slot.node.parentElement) return;
    slot.attached = false;
    changed(key, scope);
  };
}

/** Studio announces it renders this project's tools; returns the unregister. */
export function registerStudio(key: string): () => void {
  const scope = scopeFor(key);
  scope.studios += 1;
  changed(key, scope);
  return () => {
    scope.studios -= 1;
    // Unshown tools are rebuilt on the next open; shown ones keep their node for a remount.
    for (const [tool, slot] of scope.slots) if (!slot.attached) scope.slots.delete(tool);
    changed(key, scope);
  };
}

function subscribe(key: string | null, listener: () => void): () => void {
  if (key === null) return () => undefined;
  const scope = scopeFor(key);
  scope.listeners.add(listener);
  return () => {
    scope.listeners.delete(listener);
    prune(key, scope);
  };
}

/** The tool nodes Studio renders into (all, attached or not). Pass null to opt out. */
export function useStudioToolSlots(key: string | null): readonly StudioToolSlot[] {
  const listen = useCallback((listener: () => void) => subscribe(key, listener), [key]);
  return useSyncExternalStore(listen, () => (key === null ? EMPTY : scopes.get(key)?.snapshot ?? EMPTY));
}

/** Whether a Studio renders this project's tools (the host tab shows an empty state otherwise). */
export function useStudioMounted(key: string): boolean {
  const listen = useCallback((listener: () => void) => subscribe(key, listener), [key]);
  return useSyncExternalStore(listen, () => (scopes.get(key)?.studios ?? 0) > 0);
}

/** Registers a Studio for `key` while `enabled`. */
export function useStudioRegistration(key: string, enabled: boolean) {
  useEffect(() => (enabled ? registerStudio(key) : undefined), [enabled, key]);
}

/** Test seam: drops every scope. */
export function resetStudioToolBridge() {
  scopes.clear();
}
