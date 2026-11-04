import { PeerKeyUnavailableError, PrivatePeerStorage, type PeerKeyProvider } from './peer-auth.js';

const PLUGIN_KEY = /^[a-z0-9][a-z0-9-]{0,127}$/;
export const MAX_PLUGIN_STORAGE_EPOCHS = 256;

interface State { version: 1; epochs: Record<string, number> }

function validEpoch(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function pluginKey(pluginId: string): string {
  if (typeof pluginId !== 'string' || !PLUGIN_KEY.test(pluginId)) throw new Error('invalid plugin storage epoch key');
  return pluginId;
}

/**
 * App-level, monotonically increasing per-plugin storage epochs in host-owned encrypted storage, outside every
 * plugin data folder. A plugin binds its database to the epoch it last advanced; restoring or copying the plugin
 * folder cannot roll this counter back, so a stale database is detectable on its next load. Deleting the counter
 * file after it was first written fails closed through the storage's initialization marker.
 */
export class PluginStorageEpochs {
  private readonly storage: PrivatePeerStorage<State>;

  constructor(options: { directory: string; instanceId: string; keyProvider: PeerKeyProvider }) {
    this.storage = new PrivatePeerStorage(options.directory, 'storage-epochs-v1', options.keyProvider, options.instanceId,
      () => ({ version: 1, epochs: {} }), (value) => {
        const state = value as State;
        if (!state || typeof state !== 'object' || Object.keys(state).sort().join(',') !== 'epochs,version' || state.version !== 1 ||
          !state.epochs || typeof state.epochs !== 'object' || Array.isArray(state.epochs)) throw new Error('invalid plugin storage epoch state');
        const entries = Object.entries(state.epochs);
        if (entries.length > MAX_PLUGIN_STORAGE_EPOCHS || entries.some(([key, epoch]) => !PLUGIN_KEY.test(key) || !validEpoch(epoch))) {
          throw new Error('invalid plugin storage epoch state');
        }
        return state;
      });
  }

  /** Null when the host has no peer key: the fence is unavailable, which is not the same as epoch zero. */
  async current(pluginId: string): Promise<number | null> {
    const key = pluginKey(pluginId);
    try {
      return await this.storage.transaction(async (state) => Object.hasOwn(state.epochs, key) ? state.epochs[key]! : 0);
    } catch (error) {
      if (error instanceof PeerKeyUnavailableError) return null;
      throw error;
    }
  }

  /**
   * Compare-and-advance by exactly one. `live` is re-checked under the storage lock so a caller that was
   * disposed while waiting cannot commit an advance its successor would not expect.
   */
  async advance(pluginId: string, expected: number, live: () => boolean = () => true): Promise<number> {
    const key = pluginKey(pluginId);
    if (!validEpoch(expected)) throw new Error('invalid storage epoch');
    return this.storage.transaction(async (state, save) => {
      if (!live()) throw new Error('plugin context is stale');
      const known = Object.hasOwn(state.epochs, key), current = known ? state.epochs[key]! : 0;
      if (current !== expected) throw new Error('storage epoch mismatch');
      if (!known && Object.keys(state.epochs).length >= MAX_PLUGIN_STORAGE_EPOCHS) throw new Error('storage epoch capacity exceeded');
      // An unsafe successor fails state validation inside save(); nothing is written.
      const next = current + 1;
      state.epochs[key] = next;
      await save();
      return next;
    });
  }

  dispose(): void { this.storage.dispose(); }
  async whenIdle(): Promise<void> { await this.storage.whenIdle(); }
}
