import { registerHarnessSearchProvider } from './providers/harness';
import { keyboardSearchProvider } from './providers/keyboard';
import { registerCataloguesSearchProvider } from './providers/catalogues';
import { registerMachinesSearchProvider } from './providers/machines';
import { registerPluginSettingsProvider } from './providers/plugins';
import { registerSettingsSearchProvider } from './registry';

interface RuntimeHandle {
  /** Fetch plugin-defined settings (lazy, cached for the session). Call on first search focus. */
  prefetchPluginSettings: () => Promise<void>;
  dispose: () => void;
}

let handle: RuntimeHandle | undefined;

/**
 * Register every runtime provider once per renderer (idempotent). Both the
 * Settings rail and the ⌘P palette call this before searching, so neither
 * needs the other mounted. Never inside a window factory (Rule 3): this is a
 * process-lifetime singleton with an explicit `dispose`.
 */
export function ensureSettingsSearchProviders(): RuntimeHandle {
  if (handle) return handle;
  const plugins = registerPluginSettingsProvider();
  const releases = [
    registerSettingsSearchProvider(keyboardSearchProvider),
    registerHarnessSearchProvider(),
    registerMachinesSearchProvider(),
    registerCataloguesSearchProvider(),
    plugins.dispose
  ];
  handle = {
    prefetchPluginSettings: plugins.prefetch,
    dispose: () => {
      for (const release of releases) release();
      handle = undefined;
    }
  };
  return handle;
}
