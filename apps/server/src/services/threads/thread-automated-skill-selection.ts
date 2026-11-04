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

export function copyThreadAutomatedSkillIds(db: ZccDatabase, sourceThreadId: string, targetThreadId: string): void {
  const automatedSkillIds = threadAutomatedSkillIds(db, sourceThreadId);
  if (!automatedSkillIds) return;
  const result = patchThreadPluginMetadata(db, {
    threadId: targetThreadId,
    pluginId: MODERN_SQUAD_PRIVATE_NAMESPACE,
    set: { automatedSkillIds },
    remove: []
  });
  if (!result.ok) throw new Error('automated skill metadata exceeds limit');
}
