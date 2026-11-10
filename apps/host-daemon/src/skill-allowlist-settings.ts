/**
 * Turn a resolved skill allowlist into Claude `--settings` keys for a CLI spawn.
 *
 * `skillOverrides: off` hides non-allowed user/project skills and commands.
 * `enabledPlugins: false` switches off any plugin when none of its skills is
 * allowed (MCP-only and unenumerable plugins included). That includes mixed plugins (ones that also ship hooks, MCP servers or
 * agents): the point of a restriction is a lean launch, and Zana's own hooks/MCP
 * are injected via `--settings`/`--mcp-config`, not through user plugins. Those
 * are reported in `disabledMixedPlugins` so the caller can tell the user what
 * was lost. Only a plugin with some (not all) allowed skills stays on and is
 * reported as best-effort. This is a
 * context filter, not a security boundary.
 */
import { ALWAYS_ALLOWED_SKILLS, skillAllowlistCovers } from '@zana-ai/zcc-domain/product';
import type { SkillSettings } from './harness/registration.js';
import {
  scanLocalSkillInventory,
  scanRemoteSkillInventory,
  SkillInventoryUnavailableError,
  type ClaudeSkillInventory
} from './plugin-classification.js';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';

export interface SkillSettingsResult {
  /** `undefined` = nothing to emit (unrestricted, or already nothing to trim). */
  settings?: SkillSettings;
  /** Plugin ids that could not be trimmed (mixed class, or a partly-allowed plugin). */
  bestEffortPlugins: string[];
  /** Mixed plugins (hooks/MCP/agents too) switched off whole because no skill of theirs is allowed. */
  disabledMixedPlugins: string[];
}

/** Pure: allowlist (`undefined` = unrestricted) + inventory -> settings keys. */
export function buildSkillSettings(
  allowlist: readonly string[] | undefined,
  inventory: ClaudeSkillInventory
): SkillSettingsResult {
  if (allowlist === undefined) return { bestEffortPlugins: [], disabledMixedPlugins: [] };
  const skillOverrides: Record<string, 'off'> = {};
  for (const name of inventory.userSkills) {
    if (!skillAllowlistCovers(allowlist, name)) skillOverrides[name] = 'off';
  }
  const enabledPlugins: Record<string, false> = {};
  const bestEffortPlugins: string[] = [];
  const disabledMixedPlugins: string[] = [];
  for (const plugin of inventory.plugins) {
    const allowed = plugin.skills.filter((skill) => skillAllowlistCovers(allowlist, `${plugin.name}:${skill}`));
    if (allowed.length === 0) {
      // Nothing of this plugin is wanted: off whole, including MCP-only plugins and ones we
      // could not enumerate. Their tool schemas are launch context too.
      enabledPlugins[plugin.id] = false;
      if (plugin.kind === 'mixed') disabledMixedPlugins.push(plugin.id);
    } else if (allowed.length < plugin.skills.length) bestEffortPlugins.push(plugin.id);
  }
  const settings: SkillSettings = {
    ...(Object.keys(skillOverrides).length ? { skillOverrides } : {}),
    ...(Object.keys(enabledPlugins).length ? { enabledPlugins } : {}),
    // Lean persona (only always-allowed skills such as zcc-inbox): also drop user-level MCP servers (e.g. mcp-adaptor) that
    // `enabledPlugins` cannot reach. Zana's own `--mcp-config` is explicit, so it still loads.
    ...(allowlist.every((entry) => (ALWAYS_ALLOWED_SKILLS as readonly string[]).includes(entry)) ? { strictMcp: true as const } : {})
  };
  return { ...(Object.keys(settings).length ? { settings } : {}), bestEffortPlugins, disabledMixedPlugins };
}

export interface ResolveSkillSettingsInput {
  allowlist: readonly string[] | undefined;
  cwd?: string;
  /** Present for an ssh-remote spawn: the inventory is read on that machine. */
  remote?: ProjectRemote;
}

export type ResolveSkillSettingsResult = SkillSettingsResult & {
  /** Set when a restricted spawn could not read its inventory; the caller must surface it. */
  unavailable?: string;
};

/** Inventory of the machine that runs the agent, then {@link buildSkillSettings}. */
export async function resolveSkillSettings(
  input: ResolveSkillSettingsInput,
  deps: {
    local?: typeof scanLocalSkillInventory;
    remote?: typeof scanRemoteSkillInventory;
  } = {}
): Promise<ResolveSkillSettingsResult> {
  if (input.allowlist === undefined) return { bestEffortPlugins: [], disabledMixedPlugins: [] };
  let inventory: ClaudeSkillInventory | undefined;
  try {
    inventory = input.remote
      ? await (deps.remote ?? scanRemoteSkillInventory)(input.remote, input.remote.remotePath ?? input.cwd)
      : await (deps.local ?? scanLocalSkillInventory)({ cwd: input.cwd });
  } catch (err) {
    if (!(err instanceof SkillInventoryUnavailableError)) throw err;
    return { bestEffortPlugins: [], disabledMixedPlugins: [], unavailable: err.message };
  }
  if (!inventory) return { bestEffortPlugins: [], disabledMixedPlugins: [], unavailable: 'skill inventory unavailable on the execution host' };
  return buildSkillSettings(input.allowlist, inventory);
}
