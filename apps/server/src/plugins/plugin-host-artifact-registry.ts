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

  set(pluginId: string, artifact: PluginHostArtifactSnapshot): void {
    this.#byPluginId.set(pluginId, artifact);
  }

  delete(pluginId: string): void {
    this.#byPluginId.delete(pluginId);
  }

  get(pluginId: string): PluginHostArtifactSnapshot | undefined {
    return this.#byPluginId.get(pluginId);
  }

  entries(): IterableIterator<[string, PluginHostArtifactSnapshot]> {
    return this.#byPluginId.entries();
  }
}
