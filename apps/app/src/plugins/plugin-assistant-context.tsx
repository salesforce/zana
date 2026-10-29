import { createContext, useContext } from 'react';

/** The plugin page beside this assistant; absent in standalone conversations. */
export const PluginAssistantContext = createContext<string | null>(null);

export function usePluginAssistantOwner(): string | null {
  return useContext(PluginAssistantContext);
}
