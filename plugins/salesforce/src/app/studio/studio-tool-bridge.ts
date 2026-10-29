/**
 * Studio tools shown in the host side panel beside the Salesforce page.
 *
 * Each tool keeps one DOM node per Studio scope. Studio renders the tool into that
 * node through a portal, so its state (preview conversation, test results,
 * graph focus) stays in Studio. The host tab (`studio-<tool>` thread-panel
 * action, `'plugin-page'` scope) only adopts the node while it is shown. A
 * host tab that is switched away or closed hands the node back; the tool keeps
 * running detached until Studio itself unmounts. The host tab id is metadata,
 * never the identity of the tool or its agent-owned state.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export const PANEL_TOOLS = ['graph', 'preview', 'test', 'org-preview', 'actions', 'comments'] as const;
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
  registeredAt: number;
  slots: Map<PanelTool, StudioToolSlot>;
  snapshot: readonly StudioToolSlot[];
  listeners: Set<() => void>;
}

const EMPTY: readonly StudioToolSlot[] = [];
const scopes = new Map<string, Scope>();
const registrationListeners = new Set<() => void>();
const attachments = new WeakMap<HTMLElement, symbol>();
let registrationSerial = 0;
const SCOPE_PREFIX = 'studio:';

/** Older hosts and New Tab launchers use the project scope; explicit launches can name their Studio. */
export function studioToolScope(projectId?: string, studioId?: string): string {
  return studioId ? `${SCOPE_PREFIX}${JSON.stringify([projectId ?? '', studioId])}` : projectId ?? '';
}

function scopeProject(key: string): string {
  if (key.startsWith(SCOPE_PREFIX)) {
    try {
      const parts: unknown = JSON.parse(key.slice(SCOPE_PREFIX.length));
      if (Array.isArray(parts) && parts.length === 2 && parts.every(part => typeof part === 'string')) return parts[0];
    } catch { /* A legacy project key may share the prefix. */ }
  }
  return key;
}

/** An unbound New Tab follows an available Studio in its project, never another project. */
export function useStudioToolScope(projectId?: string, studioId?: string): string {
  const listen = useCallback((listener: () => void) => {
    registrationListeners.add(listener);
    return () => { registrationListeners.delete(listener); };
  }, []);
  return useSyncExternalStore(listen, () => {
    const preferred = studioToolScope(projectId, studioId);
    if (studioId || scopes.get(preferred)?.studios) return preferred;
    let latest = 0;
    let key = preferred;
    for (const [candidate, scope] of scopes) {
      if (scope.studios && scope.registeredAt > latest && scopeProject(candidate) === (projectId ?? '')) {
        latest = scope.registeredAt;
        key = candidate;
      }
    }
    return key;
  });
}

function scopeFor(key: string): Scope {
  let scope = scopes.get(key);
  if (!scope) {
    scope = { studios: 0, registeredAt: 0, slots: new Map(), snapshot: EMPTY, listeners: new Set() };
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
  for (const listener of [...registrationListeners]) listener();
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
  const attachment = Symbol();
  attachments.set(slot.node, attachment);
  container.appendChild(slot.node);
  slot.attached = true;
  if (tabId) slot.tabId = tabId;
  changed(key, scope);
  return () => {
    if (attachments.get(slot.node) !== attachment) return;
    attachments.delete(slot.node);
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
  scope.registeredAt = ++registrationSerial;
  changed(key, scope);
  return () => {
    scope.studios -= 1;
    // Unshown tools are rebuilt on the next open; shown ones keep their node for a remount.
    if (!scope.studios) for (const [tool, slot] of scope.slots) if (!slot.attached) scope.slots.delete(tool);
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
  registrationSerial = 0;
  for (const listener of [...registrationListeners]) listener();
}
