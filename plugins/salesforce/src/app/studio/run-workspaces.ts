import { callPluginRpc } from '@zana-ai/zcc-plugin-sdk/app';
import type { LabSnapshot } from '../../../lib/agentforce-lab-contract.js';
import { useCallback, useEffect, useSyncExternalStore, type SetStateAction } from 'react';

export interface StudioRunOwner { pluginId: string; projectId?: string; orgAlias?: string; path?: string; view: 'preview' | 'roleplay' | 'org-preview' }
export interface StudioRunDescriptor extends StudioRunOwner {
  key: string; runId: string; engine: 'simulate' | 'live' | 'rehearse';
  status: 'active' | 'running' | 'ended' | 'expired'; turn: number; updatedAt: number;
}
interface Workspace { key: string; at: number; values: Record<string, unknown>; descriptor?: StudioRunDescriptor }
const STORAGE = 'salesforce:studio:run-workspaces:v1';
const ROW_STORAGE_PREFIX = `${STORAGE}:`;
const LIMIT = 16;
const MAX_BYTES = 2_000_000;
let loaded = false;
const workspaces = new Map<string, Workspace>();
const mounted = new Map<string, number>();
const reconcilers = new Map<string, { users: number; timer: ReturnType<typeof setInterval> }>();
const refs = new Map<string, Record<string, { current: unknown }>>();
const listeners = new Set<() => void>();
let revision = 0;
const subscribe = (listener: () => void) => {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};
const notify = () => { revision++; listeners.forEach(listener => listener()); };
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const studioRunKey = (owner: StudioRunOwner) => JSON.stringify([owner.pluginId, owner.projectId ?? '', owner.orgAlias ?? '', owner.path ?? '', owner.view]);
function parseWorkspace(value: unknown): Workspace | null {
  if (!record(value) || typeof value.key !== 'string' || value.key.length > 16_384 || !record(value.values)) return null;
  const descriptor = value.descriptor;
  const validOwner = record(descriptor) && ['pluginId', 'runId'].every(field => typeof descriptor[field] === 'string' && (descriptor[field] as string).length > 0 && (descriptor[field] as string).length < 4096) && ['projectId', 'orgAlias', 'path'].every(field => descriptor[field] === undefined || typeof descriptor[field] === 'string' && (descriptor[field] as string).length < 4096) && typeof descriptor.turn === 'number' && Number.isInteger(descriptor.turn) && descriptor.turn >= 0 && typeof descriptor.updatedAt === 'number' && Number.isFinite(descriptor.updatedAt);
  return { key: value.key, at: Number(value.at) || 0, values: value.values,
    ...(validOwner && record(descriptor) && studioRunKey(descriptor as unknown as StudioRunOwner) === value.key && descriptor.key === value.key
      && ['preview', 'roleplay', 'org-preview'].includes(String(descriptor.view)) && ['active', 'running', 'ended', 'expired'].includes(String(descriptor.status))
      && ['simulate', 'live', 'rehearse'].includes(String(descriptor.engine)) ? { descriptor: descriptor as unknown as StudioRunDescriptor } : {}) };
}
function rowStorageKey(key: string) { return `${ROW_STORAGE_PREFIX}${encodeURIComponent(key)}`; }
function readStoredWorkspace(key: string): Workspace | null {
  try {
    const raw = localStorage.getItem(rowStorageKey(key));
    if (!raw || raw.length > MAX_BYTES) return null;
    const row = parseWorkspace(JSON.parse(raw));
    return row?.key === key ? row : null;
  } catch { return null; }
}
function storedRows(): Workspace[] {
  const rows: Workspace[] = [];
  try {
    // A legacy aggregate has at most sixteen rows. Each current workspace has
    // its own atomic storage item so windows never rewrite each other's data.
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(ROW_STORAGE_PREFIX)) continue;
      try {
        const row = readStoredWorkspace(decodeURIComponent(key.slice(ROW_STORAGE_PREFIX.length)));
        if (row) rows.push(row);
      } catch { /* Ignore a malformed key without blocking the remaining workspaces. */ }
    }
  } catch { /* Optional persistence. */ }
  return rows;
}
/** JSON restores must not replace unchanged objects: effects use their identity. */
function mergeValues(current: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const result = { ...current };
  for (const [field, value] of Object.entries(incoming)) {
    const previous = current[field];
    result[field] = Object.is(previous, value) || previous !== null && typeof previous === 'object' && JSON.stringify(previous) === JSON.stringify(value) ? previous : value;
  }
  return result;
}

function onStorage(event: StorageEvent) {
  if (!event.key?.startsWith(ROW_STORAGE_PREFIX) || !event.newValue || event.newValue.length > MAX_BYTES) return;
  try {
    const row = parseWorkspace(JSON.parse(event.newValue));
    if (!row || rowStorageKey(row.key) !== event.key) return;
    const previous = workspaces.get(row.key);
    if (previous && row.at < previous.at) return;
    if (previous && row.at === previous.at && localStorage.getItem(event.key) !== event.newValue) return;
    workspaces.set(row.key, { ...row, values: mergeValues(previous?.values ?? {}, row.values) });
    trim(row.key);
    notify();
  } catch { /* Invalid remote storage cannot interrupt a live run. */ }
}
function hydrate() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw && raw.length <= MAX_BYTES) {
      const rows: unknown = JSON.parse(raw);
      if (Array.isArray(rows)) {
      for (const value of rows.slice(-LIMIT)) {
        const row = parseWorkspace(value);
        if (!row) continue;
        // Existing resource rows win over a legacy renderer snapshot.
        const current = readStoredWorkspace(row.key) ?? row;
        workspaces.set(current.key, current);
        if (!readStoredWorkspace(row.key)) localStorage.setItem(rowStorageKey(row.key), JSON.stringify(row));
      }
      localStorage.removeItem(STORAGE);
      }
    }
  } catch { /* Storage may be unavailable; the server remains authoritative. */ }
  for (const row of storedRows().sort((a, b) => a.at - b.at).slice(-64)) workspaces.set(row.key, row);
}

function trim(keep?: string) {
  const inactive = [...workspaces.values()].filter(row => row.key !== keep && !mounted.has(row.key) && refs.get(row.key)?.locked?.current !== true && !['active', 'running'].includes(row.descriptor?.status ?? '')).sort((a, b) => a.at - b.at);
  while (workspaces.size > LIMIT && inactive.length) { const row = inactive.shift()!; workspaces.delete(row.key); refs.delete(row.key); }
  // Backend sessions are bounded to twelve per scope; cap remembered sessions across scopes as well.
  const detached = [...workspaces.values()].filter(row => row.key !== keep && !mounted.has(row.key) && refs.get(row.key)?.locked?.current !== true).sort((a, b) => a.at - b.at);
  while (workspaces.size > 64 && detached.length) { const row = detached.shift()!; workspaces.delete(row.key); refs.delete(row.key); }
}
function workspace(key: string) {
  hydrate();
  let current = workspaces.get(key);
  if (!current) { current = readStoredWorkspace(key) ?? { key, at: Date.now(), values: {} }; workspaces.set(key, current); trim(key); }
  return current;
}
function persist(key: string, field?: string, descriptorChanged = false) {
  trim(key);
  const current = workspaces.get(key)!;
  const stored = readStoredWorkspace(key);
  const next: Workspace = {
    ...current,
    at: Math.max(Date.now(), current.at + 1, (stored?.at ?? 0) + 1),
    values: { ...mergeValues(current.values, stored?.values ?? {}), ...(field ? { [field]: current.values[field] } : {}) },
    ...(!descriptorChanged && stored?.descriptor ? { descriptor: stored.descriptor } : {})
  };
  workspaces.set(key, next);
  let serialized = JSON.stringify(next);
  if (serialized.length > MAX_BYTES) {
    const heavy = new Set(['source', 'runSource', 'turns', 'traces', 'runs', 'session', 'active', 'runDetails']);
    serialized = JSON.stringify({ ...next, values: Object.fromEntries(Object.entries(next.values).filter(([name]) => !heavy.has(name))) });
    if (serialized.length > MAX_BYTES) serialized = JSON.stringify({ ...next, values: {} });
  }
  try {
    localStorage.setItem(rowStorageKey(key), serialized);
    // Prune old independent rows without ever replacing a window's whole store.
    const rows = storedRows().sort((a, b) => Number(b.key === key) - Number(a.key === key) || Number(['active', 'running'].includes(b.descriptor?.status ?? '')) - Number(['active', 'running'].includes(a.descriptor?.status ?? '')) || b.at - a.at);
    let retained = 0, bytes = 0;
    for (const row of rows) {
      const size = JSON.stringify(row).length;
      if (row.key === key || retained < LIMIT && bytes + size <= MAX_BYTES) { retained++; bytes += size; }
      else localStorage.removeItem(rowStorageKey(row.key));
    }
  } catch { /* Private/storage-full windows retain in memory. */ }
}

export function readWorkspaceValue<T>(key: string, field: string, initial: T | (() => T)): T {
  const current = workspace(key);
  if (!(field in current.values)) current.values[field] = typeof initial === 'function' ? (initial as () => T)() : initial;
  return current.values[field] as T;
}
export function writeWorkspaceValue<T>(key: string, field: string, next: SetStateAction<T>, initial: T | (() => T)) {
  const current = workspace(key);
  const stored = readStoredWorkspace(key);
  if (stored && stored.at >= current.at) current.values = mergeValues(current.values, stored.values);
  const previous = readWorkspaceValue(key, field, initial);
  const value = typeof next === 'function' ? (next as (old: T) => T)(previous) : next;
  if (Object.is(previous, value)) return;
  current.values[field] = value; current.at = Date.now(); persist(key, field); notify();
}
export function useRunWorkspaceState<T>(key: string, field: string, initial: T | (() => T)): [T, (next: SetStateAction<T>) => void] {
  useEffect(() => { mounted.set(key, (mounted.get(key) ?? 0) + 1); return () => { const count = (mounted.get(key) ?? 1) - 1; if (count) mounted.set(key, count); else mounted.delete(key); trim(); }; }, [key]);
  const get = useCallback(() => readWorkspaceValue(key, field, initial), [key, field]);
  const value = useSyncExternalStore(subscribe, get, get);
  const set = useCallback((next: SetStateAction<T>) => writeWorkspaceValue(key, field, next, initial), [key, field]);
  return [value, set];
}
/** In-flight requests keep their original owner's reference when a view detaches. */
export function runWorkspaceRef<T>(key: string, field: string, initial: T, persisted = false): { current: T } {
  let current = refs.get(key);
  if (!current) { current = {}; refs.set(key, current); }
  if (!current[field]) current[field] = persisted ? Object.defineProperty({}, 'current', { get: () => readWorkspaceValue(key, field, initial), set: (value: T) => writeWorkspaceValue(key, field, value, initial) }) as { current: T } : { current: initial };
  return current[field] as { current: T };
}
export function updateStudioRun(owner: StudioRunOwner, input: Omit<StudioRunDescriptor, keyof StudioRunOwner | 'key' | 'updatedAt'>) {
  const key = studioRunKey(owner), current = workspace(key);
  const previous = current.descriptor;
  if (previous && previous.runId === input.runId && previous.engine === input.engine && previous.status === input.status && previous.turn === input.turn) return;
  current.at = Date.now(); current.descriptor = { ...owner, ...input, key, updatedAt: current.at }; persist(key, undefined, true); notify();
}
export function getStudioRun(owner: StudioRunOwner) { return workspace(studioRunKey(owner)).descriptor ?? null; }
export function useStudioRuns(pluginId: string, projectId?: string) {
  hydrate();
  useEffect(() => {
    const scope = JSON.stringify([pluginId, projectId ?? '']);
    const existing = reconcilers.get(scope);
    if (existing) existing.users++;
    else {
      let pending = false;
      const refresh = async () => {
        if (pending) return; pending = true;
        const ownersAtRequest = new Map([...workspaces.values()].map(row => [row.key, row.descriptor]));
        try {
          const result = await callPluginRpc(pluginId, 'agentLab.list', { projectId, includeClosed: true, summaryOnly: true }) as { ok?: boolean; data?: Array<LabSnapshot & { turnCount?: number }> };
          if (!result?.ok || !Array.isArray(result.data)) return;
          const reconciled = new Set<string>();
          for (const snapshot of [...result.data].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))) {
            const known = [...workspaces.values()].flatMap(row => row.descriptor?.pluginId === pluginId && row.descriptor.projectId === projectId && row.descriptor.runId === snapshot.id ? [row.descriptor] : []);
            const owners: StudioRunOwner[] = known.length ? known : snapshot.path ? [{ pluginId, projectId, orgAlias: snapshot.orgAlias, path: snapshot.path, view: snapshot.execution ? 'roleplay' : 'preview' }] : [];
            for (const owner of owners) {
              const key = studioRunKey(owner), current = getStudioRun(owner);
              if (reconciled.has(key) || current && current !== ownersAtRequest.get(key) || current && current.runId !== snapshot.id && ['active', 'running'].includes(current.status) && (snapshot.closed || snapshot.failed)) continue;
              reconciled.add(key);
              updateStudioRun(owner, { runId: snapshot.id, engine: snapshot.live ? 'live' : snapshot.engine === 'rehearsal' ? 'rehearse' : 'simulate', status: snapshot.closed || snapshot.failed || snapshot.execution && ['done', 'stopped', 'error'].includes(snapshot.execution.phase) ? 'ended' : snapshot.busy ? 'running' : 'active', turn: snapshot.turnCount ?? snapshot.turns.filter(turn => turn.role === 'user').length });
            }
          }
        } catch { /* A disconnected server must not terminate a remembered run. */ } finally { pending = false; }
      };
      void refresh();
      reconcilers.set(scope, { users: 1, timer: setInterval(() => void refresh(), 2000) });
    }
    return () => { const current = reconcilers.get(scope); if (current && --current.users === 0) { clearInterval(current.timer); reconcilers.delete(scope); } };
  }, [pluginId, projectId]);
  useSyncExternalStore(subscribe, () => revision, () => revision);
  return [...workspaces.values()].flatMap(row => row.descriptor && row.descriptor.pluginId === pluginId && row.descriptor.projectId === projectId ? [row.descriptor] : [])
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
/** Clear both caches when changing application homes, and in isolated renderer tests. */
export function clearStudioRunWorkspaces() {
  workspaces.clear(); refs.clear(); mounted.clear(); loaded = true;
  try {
    for (const row of storedRows()) localStorage.removeItem(rowStorageKey(row.key));
    localStorage.removeItem(STORAGE);
  } catch { /* Optional storage. */ }
  notify();
}
