export interface PluginHostArtifactSnapshot {
  /** Absolute path to the validated bundle; bytes are read only when served. */
  path: string;
  byteLength: number;
  digest: string;
  /** Changes on every successful activation, even if source bytes are equal. */
  generation: string;
}

/**
 * The live `zcc.host` artifact of every loaded plugin, keyed by plugin id.
 * Presence means the plugin runtime is live and the bytes are servable to
 * enrolled daemons.
 */
export class PluginHostArtifactRegistry {
  readonly #byPluginId = new Map<string, PluginHostArtifactSnapshot>();
  readonly #uses = new Map<string, number>();
  readonly #updating = new Set<string>();

  /** An admitted host RPC keeps its generation alive until it settles. */
  acquire(pluginId: string): () => void {
    if (this.#updating.has(pluginId)) throw new Error('Plugin update in progress; retry when it completes');
    this.#uses.set(pluginId, (this.#uses.get(pluginId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.#uses.get(pluginId)! - 1;
      if (count) this.#uses.set(pluginId, count); else this.#uses.delete(pluginId);
    };
  }

  /** Close admission synchronously before checking session references or stopping writers. */
  beginUpdate(pluginId: string): () => void {
    if (this.#uses.has(pluginId)) throw new Error('Plugin has an active host call; retry the update when it finishes');
    if (this.#updating.has(pluginId)) throw new Error('Plugin update already in progress');
    this.#updating.add(pluginId);
    return () => { this.#updating.delete(pluginId); };
  }

  set(pluginId: string, artifact: PluginHostArtifactSnapshot): void {
    this.#byPluginId.set(pluginId, artifact);
  }

  delete(pluginId: string): void {
    this.#byPluginId.delete(pluginId);
  }

  get(pluginId: string): PluginHostArtifactSnapshot | undefined {
    if (this.#updating.has(pluginId)) return undefined;
    return this.#byPluginId.get(pluginId);
  }

  entries(): IterableIterator<[string, PluginHostArtifactSnapshot]> {
    return this.#byPluginId.entries();
  }

  /** Lifecycle teardown still needs the generation after new calls are gated. */
  peek(pluginId: string): PluginHostArtifactSnapshot | undefined { return this.#byPluginId.get(pluginId); }
}
