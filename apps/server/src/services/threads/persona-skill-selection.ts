import {
  ALWAYS_ALLOWED_SKILLS,
  effectiveSkills,
  mapSkillAllowlist,
  type MappedSkillAllowlist,
  type Persona,
  type Team
} from '@zana-ai/zcc-domain/product';
import { listInjectedSkillEntries } from '../skills/injected-skill-entries.js';

/**
 * Main-side resolution of a persona's skill allowlist into the two typed fields the
 * runtime carries. `{}` means unrestricted (both fields absent); a restricted persona
 * always yields both arrays, so an empty `automatedSkillIds` / `allowedSkillNames`
 * stays distinct from "unset". Never reads renderer input: persona and team come from
 * the main-owned stores.
 */
export function resolvePersonaSkillSelection(
  dataDir: string,
  team: Pick<Team, 'leanWorkers'> | undefined,
  persona: Pick<Persona, 'skills'>,
  slotRole: 'worker' | 'orchestrator'
): MappedSkillAllowlist {
  const allowlist = effectiveSkills(team, persona, slotRole);
  if (allowlist === undefined) return {};
  return mapSkillAllowlist(allowlist, listInjectedSkillEntries(dataDir));
}

/** Bare skill name of a `zcc:<owner>/<name>` catalog id. */
function catalogIdName(id: string): string {
  return id.slice(id.lastIndexOf('/') + 1);
}

/**
 * The complete skill list for a provider that filters by name (Claude SDK `Options.skills`):
 * remaining names plus the names of the selected catalog skills, so the Zana-injected
 * skills the allowlist kept stay visible. `undefined` (no `allowedSkillNames`) = unrestricted.
 */
export function providerSkillAllowlist(
  automatedSkillIds: readonly string[] | undefined,
  allowedSkillNames: readonly string[] | undefined
): string[] | undefined {
  if (allowedSkillNames === undefined) return undefined;
  return [...new Set([...ALWAYS_ALLOWED_SKILLS, ...allowedSkillNames, ...(automatedSkillIds ?? []).map(catalogIdName)])];
}

/**
 * Catalog ids for an automated / isolated run (squad member). A persona allowlist may only
 * narrow: the baseline is the explicit authorized selection, or `[]` (today's automated
 * default, no injected skills). Unrestricted (`mapped` undefined) keeps the baseline as-is.
 */
export function narrowAutomatedSkillIds(
  explicit: readonly string[] | undefined,
  mapped: readonly string[] | undefined
): string[] | undefined {
  if (mapped === undefined) return explicit === undefined ? undefined : [...explicit];
  const allowed = new Set(mapped);
  return (explicit ?? []).filter((id) => allowed.has(id));
}
