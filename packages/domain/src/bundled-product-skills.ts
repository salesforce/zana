/**
 * Shipped product skills under `apps/server/src/plugins/builtin-skills`.
 * Settings and CLI opt-outs key off these ids; keep in lockstep with the
 * on-disk directories (guarded by injected-skill-roots tests).
 */
export const BUNDLED_PRODUCT_SKILLS = [
  { id: 'zcc-cli', label: 'CLI' },
  { id: 'zcc-inbox', label: 'Inbox' },
  { id: 'zcc-browser', label: 'Browser' },
  { id: 'zcc-center', label: 'Center' },
  { id: 'zcc-plugin-authoring', label: 'Plugin authoring' },
  { id: 'extension-creator', label: 'Extension creator' },
  { id: 'submit-a-plugin', label: 'Submit a plugin' },
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'saved-reports', label: 'Saved reports' },
  { id: 'zcc-preview', label: 'Preview' }
] as const;

export type BundledProductSkillId = (typeof BUNDLED_PRODUCT_SKILLS)[number]['id'];

export const BUNDLED_PRODUCT_SKILL_IDS: readonly BundledProductSkillId[] =
  BUNDLED_PRODUCT_SKILLS.map((skill) => skill.id);

export function isBundledProductSkillId(value: string): value is BundledProductSkillId {
  return (BUNDLED_PRODUCT_SKILL_IDS as readonly string[]).includes(value);
}
