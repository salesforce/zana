import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';

/** Persisted workspace mode from before Docs was a plugin. Still round-trips. */
export const LEGACY_LIBRARY_WORKSPACE_MODE = 'library';

export function isLibraryPluginModule(module: AppModule): boolean {
  return module.icon === 'Library' || module.projectTab?.icon === 'Library';
}

/** Resolve a project-tab module, including the pre-plugin `'library'` alias. */
export function resolveProjectTabModule(
  mode: string,
  tabs: readonly AppModule[]
): AppModule | undefined {
  const exact = tabs.find((module) => module.id === mode);
  if (exact) return exact;
  if (mode === LEGACY_LIBRARY_WORKSPACE_MODE) return tabs.find(isLibraryPluginModule);
  return undefined;
}
