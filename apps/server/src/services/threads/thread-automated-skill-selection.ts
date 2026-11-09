import { getThreadPluginMetadata, patchThreadPluginMetadata, type ZccDatabase } from '@zana-ai/zcc-db';
import { MODERN_SQUAD_PRIVATE_NAMESPACE } from '@zana-ai/zcc-domain/squad-origin';

const MAX_SKILL_IDS = 64;

export function threadAutomatedSkillIds(db: ZccDatabase, threadId: string): string[] | undefined {
  const stored = getThreadPluginMetadata(db, threadId, MODERN_SQUAD_PRIVATE_NAMESPACE);
  if (stored.corrupt) throw new Error('automated skill metadata is corrupt');
  if (!Object.hasOwn(stored.metadata, 'automatedSkillIds')) return undefined;
  const value = stored.metadata.automatedSkillIds;
  if (!Array.isArray(value) || value.length > MAX_SKILL_IDS
    || value.some(id => typeof id !== 'string' || id.length < 1 || id.length > 256)
    || new Set(value).size !== value.length) throw new Error('automated skill metadata is invalid');
  return value as string[];
}

/**
 * Main-authorized user/plugin skill names for a Modern squad member. `undefined` =
 * unrestricted (key absent); `[]` = restricted to the catalog selection only.
 */
export function threadAllowedSkillNames(db: ZccDatabase, threadId: string): string[] | undefined {
  const stored = getThreadPluginMetadata(db, threadId, MODERN_SQUAD_PRIVATE_NAMESPACE);
  if (stored.corrupt) throw new Error('allowed skill metadata is corrupt');
  if (!Object.hasOwn(stored.metadata, 'allowedSkillNames')) return undefined;
  const value = stored.metadata.allowedSkillNames;
  if (!Array.isArray(value) || value.length > MAX_SKILL_IDS
    || value.some(name => typeof name !== 'string' || name.length < 1 || name.length > 256)) {
    throw new Error('allowed skill metadata is invalid');
  }
  return value as string[];
}

/** Both main-authorized selection fields for provider-option derivation. */
export function threadSkillSelection(db: ZccDatabase, threadId: string): {
  automatedSkillIds?: string[];
  allowedSkillNames?: string[];
} {
  const automatedSkillIds = threadAutomatedSkillIds(db, threadId);
  const allowedSkillNames = threadAllowedSkillNames(db, threadId);
  return {
    ...(automatedSkillIds !== undefined ? { automatedSkillIds } : {}),
    ...(allowedSkillNames !== undefined ? { allowedSkillNames } : {})
  };
}

/** Copy both main-authorized selection fields to a fork; an absent field stays absent (unrestricted). */
export function copyThreadSkillSelection(db: ZccDatabase, sourceThreadId: string, targetThreadId: string): void {
  const { automatedSkillIds, allowedSkillNames } = threadSkillSelection(db, sourceThreadId);
  if (automatedSkillIds === undefined && allowedSkillNames === undefined) return;
  const result = patchThreadPluginMetadata(db, {
    threadId: targetThreadId,
    pluginId: MODERN_SQUAD_PRIVATE_NAMESPACE,
    set: {
      ...(automatedSkillIds !== undefined ? { automatedSkillIds } : {}),
      ...(allowedSkillNames !== undefined ? { allowedSkillNames } : {})
    },
    remove: []
  });
  if (!result.ok) throw new Error('thread skill selection metadata exceeds limit');
}
