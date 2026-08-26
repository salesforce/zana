import type { PluginComposerApi } from '@zana-ai/zcc-plugin-sdk/app';

const composerApiRef: { current: PluginComposerApi | null } = { current: null };

export function setActiveComposerApi(api: PluginComposerApi | null): void {
  composerApiRef.current = api;
}

export function getActiveComposerApi(): PluginComposerApi | null {
  return composerApiRef.current;
}
