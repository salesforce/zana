import { isPluginId } from './plugin-id.js';

export const PLUGIN_REQUIRES_MAX = 16;

export interface PluginRequireNode {
  id: string;
  requires: readonly string[];
}

export interface PluginRequireCycle<T extends PluginRequireNode> {
  plugin: T;
  cycle: string[];
}

export interface PluginRequireOrder<T extends PluginRequireNode> {
  ordered: T[];
  cycles: PluginRequireCycle<T>[];
}

/**
 * Kahn topo-sort so providers load before dependents. Missing required ids are
 * ignored for ordering (the consumer's `use()` throws at call time). Self-edges
 * and mutual cycles are reported, not ordered.
 */
export function sortPluginsByRequires<T extends PluginRequireNode>(
  plugins: readonly T[]
): PluginRequireOrder<T> {
  const byId = new Map<string, T>();
  for (const plugin of plugins) byId.set(plugin.id, plugin);

  const dependents = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const plugin of plugins) {
    indegree.set(plugin.id, 0);
    dependents.set(plugin.id, new Set());
  }
  for (const plugin of plugins) {
    const seen = new Set<string>();
    for (const requiredId of plugin.requires) {
      if (!requiredId || seen.has(requiredId) || !byId.has(requiredId)) continue;
      seen.add(requiredId);
      if (requiredId === plugin.id) {
        indegree.set(plugin.id, (indegree.get(plugin.id) ?? 0) + 1);
        continue;
      }
      const bucket = dependents.get(requiredId);
      if (!bucket || bucket.has(plugin.id)) continue;
      bucket.add(plugin.id);
      indegree.set(plugin.id, (indegree.get(plugin.id) ?? 0) + 1);
    }
  }

  const queue = [...indegree.entries()]
    .filter(([, degree]) => degree === 0)
    .map(([id]) => id)
    .sort((a, b) => a.localeCompare(b));
  const ordered: T[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const plugin = byId.get(id);
    if (plugin) ordered.push(plugin);
    const nextIds = [...(dependents.get(id) ?? [])].sort((a, b) => a.localeCompare(b));
    for (const nextId of nextIds) {
      const nextDegree = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, nextDegree);
      if (nextDegree === 0) queue.push(nextId);
    }
  }

  const leftover = plugins.filter((plugin) => !ordered.includes(plugin));
  const cycles: PluginRequireCycle<T>[] = leftover.map((plugin) => ({
    plugin,
    cycle: findCycle(plugin.id, byId)
  }));
  return { ordered, cycles };
}

function findCycle<T extends PluginRequireNode>(startId: string, byId: Map<string, T>): string[] {
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string): string[] | null => {
    if (onStack.has(id)) {
      const from = stack.indexOf(id);
      return [...stack.slice(from), id];
    }
    if (visiting.has(id)) return null;
    visiting.add(id);
    onStack.add(id);
    stack.push(id);
    const plugin = byId.get(id);
    for (const requiredId of plugin?.requires ?? []) {
      if (requiredId === id) return [id, id];
      if (!byId.has(requiredId)) continue;
      const found = visit(requiredId);
      if (found) return found;
    }
    stack.pop();
    onStack.delete(id);
    return null;
  };

  return visit(startId) ?? [startId];
}

export function formatPluginRequireCycle(cycle: string[]): string {
  return cycle.join(' -> ');
}

export function parsePluginRequires(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('zcc.requires must be an array of plugin ids');
  if (value.length > PLUGIN_REQUIRES_MAX) {
    throw new Error(`zcc.requires has at most ${PLUGIN_REQUIRES_MAX} entries`);
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !isPluginId(entry.trim())) {
      throw new Error('zcc.requires entries must be plugin ids');
    }
    const id = entry.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}
