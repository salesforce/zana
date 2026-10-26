import { useSyncExternalStore } from 'react';

// Renderer presentation only: no terminal creation, authorization or PTY access.
const registrations = new Map<object, { sessionId: string; element: HTMLElement }>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, HTMLElement> = new Map();
function publish() {
  snapshot = new Map([...registrations.values()].map(row => [row.sessionId, row.element]));
  listeners.forEach(listener => listener());
}
export function registerTerminalDock(sessionId: string, element: HTMLElement): () => void {
  const token = {};
  registrations.set(token, { sessionId, element });
  publish();
  return () => { registrations.delete(token); publish(); };
}
export function useTerminalDockTargets() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => snapshot);
}
