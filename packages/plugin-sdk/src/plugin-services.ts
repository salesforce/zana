/**
 * Plugin-to-plugin service registry. A plugin `provide()`s an in-process
 * object keyed by its own id; others `use()` a live proxy that always
 * dispatches to the current impl (survives provider reload).
 *
 * Experimental until a second in-tree consumer exists. Core never names a
 * concrete plugin id here.
 */

export const PLUGIN_SERVICE_UNAVAILABLE = 'service_unavailable' as const;

export class PluginServiceUnavailableError extends Error {
  readonly code = PLUGIN_SERVICE_UNAVAILABLE;

  constructor(readonly serviceId: string) {
    super(`plugin service is unavailable: ${serviceId}`);
    this.name = 'PluginServiceUnavailableError';
  }
}

export interface PluginServicesRegistry {
  provide(pluginId: string, implementation: object): () => void;
  use<T extends object>(pluginId: string): T;
  has(pluginId: string): boolean;
}

export interface PluginServices {
  /**
   * Publish this plugin's SDK, keyed by `zcc.pluginId`. Calling again replaces
   * the previous impl. Dispose unregisters only this generation.
   */
  provide(implementation: object): void;
  /**
   * Live proxy for another plugin's provided SDK. Method calls throw
   * {@link PluginServiceUnavailableError} until that plugin is running and
   * has called `provide`.
   */
  use<T extends object>(pluginId: string): T;
  /** True when that plugin has called `provide` for the current generation. */
  has(pluginId: string): boolean;
}

interface RegistryEntry {
  implementation: object;
  generation: number;
}

export function createLiveServiceProxy<T extends object>(
  getImplementation: () => T | undefined,
  serviceId: string
): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      const implementation = getImplementation();
      if (!implementation) throw new PluginServiceUnavailableError(serviceId);
      const value = Reflect.get(implementation, prop, implementation);
      if (typeof value === 'function') {
        return (...args: unknown[]) => Reflect.apply(value, implementation, args);
      }
      return value;
    },
    has(_target, prop) {
      const implementation = getImplementation();
      if (!implementation) return false;
      return Reflect.has(implementation, prop);
    }
  });
}

export function createPluginServicesRegistry(): PluginServicesRegistry {
  const entries = new Map<string, RegistryEntry>();
  let generation = 0;
  return {
    provide(pluginId, implementation) {
      if (!pluginId.trim()) throw new Error('plugin service id is required');
      if (!implementation || typeof implementation !== 'object') {
        throw new Error('plugin service implementation must be an object');
      }
      const nextGeneration = (generation += 1);
      entries.set(pluginId, { implementation, generation: nextGeneration });
      return () => {
        const current = entries.get(pluginId);
        if (current?.generation === nextGeneration) entries.delete(pluginId);
      };
    },
    use<T extends object>(pluginId: string): T {
      const id = pluginId.trim();
      if (!id) throw new Error('plugin service id is required');
      return createLiveServiceProxy(() => entries.get(id)?.implementation as T | undefined, id);
    },
    has(pluginId) {
      return entries.has(pluginId.trim());
    }
  };
}

export function bindPluginServices(
  pluginId: string,
  registry: PluginServicesRegistry,
  onDispose: (hook: () => void) => void
): PluginServices {
  return {
    provide(implementation) {
      const unregister = registry.provide(pluginId, implementation);
      onDispose(unregister);
    },
    use<T extends object>(id: string) {
      return registry.use<T>(id);
    },
    has(id) {
      return registry.has(id);
    }
  };
}
