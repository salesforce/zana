import { createContext, useContext } from 'react';
import type { PluginPageContext } from '@zana-ai/zcc-domain/thread-runtime';

/** The plugin page beside this assistant; absent in standalone conversations. */
export const PluginAssistantContext = createContext<string | null>(null);

/** Capture at submission, including follow-ups; never mutate a running task's context. */
export const PluginAssistantPageContext = createContext<(() => PluginPageContext) | null>(null);

export function usePluginAssistantPageContext(): (() => PluginPageContext) | null {
  return useContext(PluginAssistantPageContext);
}

export function usePluginAssistantOwner(): string | null {
  return useContext(PluginAssistantContext);
}
