import { useCallback, useEffect, useState } from 'react';
import { parseAgentforcePanelFocus } from './agentforce-panel-params.js';

const STORAGE = 'salesforce.agentforce-targets.v1';
const CHANGED = 'sf:agentforce-target-changed';
type Target = { path?: string; apiName?: string };
type Selection = { scope: string; target: Target; requests: Record<string, string> };

function selections(): Selection[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
    return Array.isArray(rows) ? rows.filter(row => typeof row?.scope === 'string' && row.target &&
      (typeof row.target.path === 'string' || typeof row.target.apiName === 'string') &&
      row.requests && typeof row.requests === 'object' && !Array.isArray(row.requests)).slice(0, 30) : [];
  } catch { return []; }
}

function save(selection: Selection) {
  try { localStorage.setItem(STORAGE, JSON.stringify([selection, ...selections().filter(row => row.scope !== selection.scope)].slice(0, 30))); }
  catch { /* Selection recovery is optional; keep the mounted panels usable. */ }
  window.dispatchEvent(new CustomEvent(CHANGED, { detail: selection }));
}

/** Playground and Preview share an agent within their owning project/thread.
 * Remember consumed panel requests too: old card params must not undo a later
 * picker choice when the host unmounts a tab and then mounts it again.
 * Stored paths are advisory; the file/preview RPCs still authorize them.
 */
export function useAgentforceTarget(input: {
  pluginId: string; projectId?: string; threadId?: string; tabId?: string;
  surface: 'playground' | 'preview'; params?: unknown; resourceId?: string;
}) {
  const scope = JSON.stringify([input.pluginId, input.projectId ?? '', input.threadId ?? '', ...(input.resourceId ? [input.resourceId] : [])]);
  const consumer = JSON.stringify([input.surface, input.tabId ?? '']);
  const focus = parseAgentforcePanelFocus(input.params);
  const path = focus.path;
  const apiName = input.surface === 'preview' && !path ? focus.apiName : undefined;
  const request = path || apiName ? JSON.stringify([path ?? '', apiName ?? '', focus.nonce ?? 0]) : '';
  const resolve = () => {
    const saved = selections().find(row => row.scope === scope);
    return request && saved?.requests[consumer] !== request ? { path, apiName } : saved?.target ?? null;
  };
  const [target, setTarget] = useState<Target | null>(resolve);

  useEffect(() => {
    const saved = selections().find(row => row.scope === scope);
    const next = resolve();
    setTarget(next);
    if (request && next && saved?.requests[consumer] !== request) {
      const requests = Object.fromEntries([[consumer, request], ...Object.entries(saved?.requests ?? {}).filter(([key]) => key !== consumer)].slice(0, 20));
      save({ scope, target: next, requests });
    }
    const changed = (event: Event) => {
      const selection = (event as CustomEvent<Selection>).detail;
      if (selection.scope === scope) setTarget(selection.target);
    };
    const stored = (event: StorageEvent) => { if (event.key === STORAGE || event.key === null) setTarget(resolve()); };
    window.addEventListener(CHANGED, changed);
    window.addEventListener('storage', stored);
    return () => { window.removeEventListener(CHANGED, changed); window.removeEventListener('storage', stored); };
    // The request contains all target fields; resolve reads the current saved selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, consumer, request]);

  const select = useCallback((next: Target) => {
    const saved = selections().find(row => row.scope === scope);
    setTarget(next);
    if (saved?.target.path === next.path && saved?.target.apiName === next.apiName) return;
    save({ scope, target: next, requests: saved?.requests ?? {} });
  }, [scope]);
  return { target, select };
}
