import type { AvailableModel } from '@zana-ai/zcc-domain/thread-runtime';

export interface ThreadComposerProviderOption {
  id: string;
  displayName: string;
  permissionModes: string[];
  composerActions: string[];
  serviceTiers?: Array<{id:string; label:string; description?:string}>;
}

const FALLBACK_PROVIDERS: readonly ThreadComposerProviderOption[] = [
  { id: 'claude-code', displayName: 'Claude Code', permissionModes: ['accept-edits', 'auto', 'full'], composerActions: ['plan'] },
  { id: 'codex', displayName: 'Codex', permissionModes: ['accept-edits', 'auto', 'full'], composerActions: ['plan', 'goal'] },
  { id: 'pi', displayName: 'Pi', permissionModes: ['full'], composerActions: [] },
  { id: 'acp-cursor', displayName: 'Cursor', permissionModes: ['accept-edits', 'full'], composerActions: [] },
  { id: 'acp-opencode', displayName: 'OpenCode', permissionModes: ['accept-edits', 'full'], composerActions: [] },
  { id: 'acp-grok', displayName: 'Grok Build', permissionModes: ['accept-edits', 'full'], composerActions: [] },
  { id: 'acp-mastracode', displayName: 'Mastra Code', permissionModes: ['accept-edits', 'full'], composerActions: [] },
  { id: 'fake', displayName: 'Fake', permissionModes: ['full'], composerActions: ['plan'] }
];

export function fallbackProviderOption(providerId: string): ThreadComposerProviderOption {
  return FALLBACK_PROVIDERS.find((row) => row.id === providerId)
    ?? { id: providerId, displayName: providerId, permissionModes: ['accept-edits', 'full'], composerActions: [] };
}

/** Bootstrap provider chrome only; models always come from server-owned discovery. */
export function fallbackProvidersForNewThread(): ThreadComposerProviderOption[] {
  return FALLBACK_PROVIDERS.filter((row) =>
    row.id !== 'fake' && row.id !== 'acp-opencode' && row.id !== 'acp-grok' && row.id !== 'acp-mastracode'
  );
}

export function isOfferedModernProvider(
  registeredProviderIds: readonly string[],
  providerId: string | undefined
): boolean {
  return typeof providerId === 'string' && registeredProviderIds.includes(providerId);
}

export function composerProvidersFromCatalog(
  catalogProviders: readonly ThreadComposerProviderOption[],
  locked: boolean,
  providerId: string
): ThreadComposerProviderOption[] {
  if (locked) return catalogProviders.length > 0 ? [...catalogProviders] : [fallbackProviderOption(providerId)];
  return catalogProviders.length > 0 ? [...catalogProviders] : fallbackProvidersForNewThread();
}

export function snapNewThreadProviderId(
  offeredIds: readonly string[],
  providerId: string,
  preferredProviderId?: string | null
): string | null {
  if (offeredIds.length === 0 || offeredIds.includes(providerId)) return null;
  if (preferredProviderId && offeredIds.includes(preferredProviderId)) return preferredProviderId;
  return offeredIds[0] ?? null;
}

/** There is deliberately no renderer-owned model catalog. */
export function fallbackModelsForProvider(_providerId: string): AvailableModel[] {
  return [];
}

/** Aliases are provider data and arrive through live discovery. */
export function fallbackMoreModelsForProvider(_providerId: string): AvailableModel[] {
  return [];
}
