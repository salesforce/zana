const STORAGE_KEY = 'zcc.composer.selection';
const MAX_PROVIDERS = 20;

export interface ComposerProviderSelection {
  model: string;
  reasoningLevel?: string;
}

export interface ComposerSelectionPreference {
  providerId?: string;
  byProvider: Record<string, ComposerProviderSelection>;
}

function emptyPreference(): ComposerSelectionPreference {
  return { byProvider: {} };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function parseComposerSelectionPreference(raw: string | null): ComposerSelectionPreference {
  try {
    const value = JSON.parse(raw ?? '') as Record<string, unknown>;
    if (!value || typeof value !== 'object') return emptyPreference();
    const byProvider: Record<string, ComposerProviderSelection> = {};
    if (value.byProvider && typeof value.byProvider === 'object') {
      for (const [providerId, entry] of Object.entries(value.byProvider as Record<string, unknown>)) {
        if (!providerId || !entry || typeof entry !== 'object') continue;
        const model = asNonEmptyString((entry as { model?: unknown }).model);
        if (!model) continue;
        const reasoningLevel = asNonEmptyString((entry as { reasoningLevel?: unknown }).reasoningLevel);
        byProvider[providerId] = reasoningLevel ? { model, reasoningLevel } : { model };
        if (Object.keys(byProvider).length >= MAX_PROVIDERS) break;
      }
    }
    const providerId = asNonEmptyString(value.providerId);
    return {
      ...(providerId ? { providerId } : {}),
      byProvider
    };
  } catch {
    return emptyPreference();
  }
}

export function readComposerSelectionPreference(): ComposerSelectionPreference {
  try {
    return parseComposerSelectionPreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return emptyPreference();
  }
}

export function writeComposerSelectionPreference(next: ComposerSelectionPreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage full / unavailable — preference is best-effort */
  }
}

export function rememberComposerSelection(input: {
  providerId: string;
  model: string;
  reasoningLevel?: string;
}): void {
  const providerId = input.providerId.trim();
  const model = input.model.trim();
  if (!providerId || !model) return;
  const current = readComposerSelectionPreference();
  const previous = current.byProvider[providerId];
  const reasoningLevel = input.reasoningLevel?.trim() || previous?.reasoningLevel;
  const byProvider = { ...current.byProvider };
  const providerIds = Object.keys(byProvider);
  if (!byProvider[providerId] && providerIds.length >= MAX_PROVIDERS) {
    delete byProvider[providerIds[0]!];
  }
  byProvider[providerId] = reasoningLevel ? { model, reasoningLevel } : { model };
  writeComposerSelectionPreference({ providerId, byProvider });
}

export function rememberedProviderId(): string | undefined {
  return readComposerSelectionPreference().providerId;
}

export function rememberedSelectionFor(providerId: string): ComposerProviderSelection | undefined {
  return readComposerSelectionPreference().byProvider[providerId];
}

/**
 * New-thread composers keep the last picked model (e.g. Opus) instead of
 * snapping back to the catalog default (Sonnet) when the roster loads.
 * Existing threads ignore the cache and keep whatever the thread already uses.
 */
export function preferredComposerModel(input: {
  rememberedModel: string | undefined;
  currentModel: string;
  persistRemembered: boolean;
  offeredModels: readonly string[];
  fallbackModel: string;
  loading: boolean;
}): string {
  const offered = (model: string) => input.loading || input.offeredModels.includes(model);
  if (input.persistRemembered && input.rememberedModel && offered(input.rememberedModel)) {
    return input.rememberedModel;
  }
  if (input.currentModel && offered(input.currentModel)) {
    return input.currentModel;
  }
  return input.fallbackModel;
}

export function __clearComposerSelectionForTest(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
