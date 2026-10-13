import { isSkillState, type SkillState } from '@zana-ai/zcc-domain/product';
import { injectedSkillNameFromId, isInjectedSkillId } from './injected-skill-entries.js';
import { setSkillPolicyStates } from './skill-policy.js';
import { setSkillStates } from './skill-settings.js';

export interface SkillStateUpdate {
  /** `SkillEntry.id`; decides which owner records the state. */
  id: string;
  /** Short name, used for Claude Code's name-keyed `skillOverrides`. */
  name: string;
  state: SkillState;
}

export interface SkillStateResult {
  ok: boolean;
  applied: number;
  rejected: number;
}

/** Claude Code keeps its historical tool-less `${source}:${qualified}` ids; plugin rows are /plugin-managed. */
function isClaudeSettingsId(id: string): boolean {
  const source = id.split(':', 1)[0];
  return (source === 'user' || source === 'project') && id.length > source.length + 1;
}

/**
 * Route each update to its owner: ZCC-injected skills to the ZCC policy file
 * (enforced by the host daemon for every harness), Claude Code user/project
 * skills to `skillOverrides`. Everything else is read-only and rejected.
 * Inputs come from the renderer, so ids, names and states are re-validated here.
 */
export async function applySkillStates(
  dataDir: string,
  updates: ReadonlyArray<SkillStateUpdate>
): Promise<SkillStateResult> {
  const injected: Array<{ name: string; state: SkillState }> = [];
  const claude: Array<{ name: string; state: SkillState }> = [];
  let rejected = 0;
  for (const update of Array.isArray(updates) ? updates.slice(0, 2048) : []) {
    if (!update || typeof update.id !== 'string' || !isSkillState(update.state)) {
      rejected += 1;
      continue;
    }
    if (isInjectedSkillId(update.id)) {
      const name = injectedSkillNameFromId(update.id);
      if (name) injected.push({ name, state: update.state });
      else rejected += 1;
    } else if (isClaudeSettingsId(update.id) && typeof update.name === 'string' && update.name) {
      claude.push({ name: update.name, state: update.state });
    } else {
      rejected += 1;
    }
  }
  await setSkillPolicyStates(dataDir, injected);
  await setSkillStates(claude);
  return { ok: rejected === 0, applied: injected.length + claude.length, rejected };
}
