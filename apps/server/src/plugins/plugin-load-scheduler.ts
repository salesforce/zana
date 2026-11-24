/** How many plugins `plugins.start()` activates at the same time. */
export const PLUGIN_STARTUP_CONCURRENCY = 4;

export interface PluginLoadNode {
  id: string;
  requires: readonly string[];
}

export interface PluginLoadOptions<T extends PluginLoadNode> {
  load(node: T): Promise<void>;
  /** Checked before each plugin starts; false stops scheduling new work. */
  shouldContinue?: () => boolean;
  concurrency?: number;
  /** Called for every load error after the first one, which is rethrown. */
  onError?: (error: unknown, node: T) => void;
}

/**
 * Loads plugins concurrently while keeping the dependency order: a plugin
 * starts only after every plugin it requires (among `nodes`) has finished
 * loading, and at most `concurrency` load at once. Required ids that are not in
 * `nodes` are ignored, as in the topological sort. If a load throws, nothing new
 * starts, running loads finish, and the first error is rethrown.
 *
 * `nodes` must already be free of require cycles (see `sortPluginsByRequires`); if
 * plugins are left waiting with nothing running and scheduling was not stopped,
 * the load order is stuck and an error naming them is thrown.
 */
export async function loadPluginsConcurrently<T extends PluginLoadNode>(
  nodes: readonly T[],
  options: PluginLoadOptions<T>
): Promise<void> {
  const limit = Math.max(1, Math.floor(options.concurrency ?? PLUGIN_STARTUP_CONCURRENCY));
  const ids = new Set(nodes.map((node) => node.id));
  const waiting = [...nodes];
  const finished = new Set<string>();
  const running = new Map<string, Promise<void>>();
  let failed = false;
  let firstError: unknown;

  const ready = (node: T) => node.requires.every((id) => id === node.id || !ids.has(id) || finished.has(id));

  while (waiting.length > 0 || running.size > 0) {
    while (!failed && running.size < limit && (options.shouldContinue?.() ?? true)) {
      const index = waiting.findIndex(ready);
      if (index < 0) break;
      const [node] = waiting.splice(index, 1);
      // A synchronous throw takes the same failure path as a rejection.
      let pending: Promise<void>;
      try { pending = Promise.resolve(options.load(node)); } catch (error) { pending = Promise.reject(error); }
      running.set(node.id, pending.then(
        () => { finished.add(node.id); running.delete(node.id); },
        (error: unknown) => {
          if (!failed) { failed = true; firstError = error; } else options.onError?.(error, node);
          finished.add(node.id);
          running.delete(node.id);
        }
      ));
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  if (failed) throw firstError;
  if (waiting.length > 0 && (options.shouldContinue?.() ?? true)) {
    throw new Error(`plugin load order is stuck waiting on: ${waiting.map((node) => node.id).join(', ')}`);
  }
}
