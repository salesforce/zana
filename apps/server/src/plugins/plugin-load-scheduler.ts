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
}

/**
 * Loads plugins concurrently while keeping the dependency order: a plugin
 * starts only after every plugin it requires (among `nodes`) has finished
 * loading, and at most `concurrency` load at once. Required ids that are not in
 * `nodes` are ignored, as in the topological sort. If a load throws, nothing new
 * starts, running loads finish, and the first error is rethrown.
 *
 * `nodes` must already be free of require cycles (see `sortPluginsByRequires`).
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
      running.set(node.id, options.load(node).then(
        () => { finished.add(node.id); running.delete(node.id); },
        (error: unknown) => { if (!failed) { failed = true; firstError = error; } finished.add(node.id); running.delete(node.id); }
      ));
    }
    if (running.size === 0) break;
    await Promise.race(running.values());
  }
  if (failed) throw firstError;
}
