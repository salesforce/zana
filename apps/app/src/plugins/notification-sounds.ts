/** A reference to an installed provider, never a file path or a capability. */
export const soundProviderKey = (provider: { pluginId: string; id: string }): string => `${provider.pluginId}/${provider.id}`;
/** Opens configuration without changing the selected provider or enabling audio. */
export const soundProviderSettingsHref = (provider: { pluginId: string; id: string }): string =>
  `/settings/notifications?provider=${encodeURIComponent(soundProviderKey(provider))}#agent-sounds`;
