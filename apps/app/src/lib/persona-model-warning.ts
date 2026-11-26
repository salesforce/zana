import type { Persona } from '@zana-ai/zcc-domain/product';
import { harnessFamilyOf, threadProviderIdForHarnessFamily } from '@zana-ai/zcc-domain/launch-provider';
import type { ThreadModelCatalogSnapshot } from '../components/thread/pickers/thread-model-catalog.js';

/**
 * Harness families whose launch rejects nothing a catalog lacks but whose models are
 * listed by the provider itself. Families that accept unlisted model ids (Claude,
 * Cursor, Codex, Grok, Mastra Code) are never checked here.
 */
const CATALOG_CHECKED_FAMILIES: ReadonlySet<string> = new Set(['pi', 'opencode']);

export interface UnknownPersonaModel { personaId: string; personaName: string; model: string }

/**
 * Personas whose legacy `model` string the loaded provider catalog does not list.
 * Advisory only. Reads the already-cached catalog snapshot; it never fetches, and a
 * catalog that has not loaded, errored, or is only inherited yields no warning.
 */
export function unknownPersonaModels(
  personas: ReadonlyArray<Pick<Persona, 'id' | 'name' | 'model' | 'baseProfile'>>,
  catalog: Pick<ThreadModelCatalogSnapshot, 'byProvider' | 'provisionalProviders'>
): UnknownPersonaModel[] {
  const out: UnknownPersonaModel[] = [];
  for (const persona of personas) {
    const model = persona.model?.trim();
    if (!model || model === 'default' || !persona.baseProfile) continue;
    const family = harnessFamilyOf(persona.baseProfile);
    if (!family || !CATALOG_CHECKED_FAMILIES.has(family)) continue;
    const providerId = threadProviderIdForHarnessFamily(family);
    const entry = providerId ? catalog.byProvider[providerId] : undefined;
    if (!providerId || !entry || entry.modelLoadError || entry.models.length === 0) continue;
    if (catalog.provisionalProviders.has(providerId)) continue;
    const needle = model.toLowerCase();
    const listed = entry.models.some((m) => m.id.toLowerCase().includes(needle) || m.displayName?.toLowerCase() === needle);
    if (!listed) out.push({ personaId: persona.id, personaName: persona.name, model });
  }
  return out;
}
