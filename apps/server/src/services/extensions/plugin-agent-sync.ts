import { readFile } from 'node:fs/promises';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { rebuildPluginServers, type PluginMcpContributor } from '@zana-ai/zcc-host-daemon/mcp-config';
import {
  reconcilePluginAgentsSkills,
  type PluginAgentsSkillEntry
} from '@zana-ai/zcc-host-daemon/plugin-agents-skills';
import { discoverPluginSkillNames } from '../../plugins/plugin-skills.js';
import { syncPluginSkills, type PluginSkillContributor } from '../skills/skill-installer.js';

export interface PluginAgentSyncInput extends PluginMcpContributor, PluginSkillContributor {}

/**
 * Read the SKILL.md of every skill an ENABLED plugin ships, using the same
 * discovery as the `~/.claude/skills` deploy. Disabled plugins contribute
 * nothing, which is what makes the reconcile remove their entries.
 */
export async function collectPluginAgentsSkills(
  contributors: readonly PluginSkillContributor[],
  log?: (context: string, err: unknown) => void
): Promise<PluginAgentsSkillEntry[]> {
  const out: PluginAgentsSkillEntry[] = [];
  for (const plugin of contributors) {
    if (!plugin.enabled) continue;
    for (const skillName of discoverPluginSkillNames(plugin.rootDir, plugin.skillsRootPaths)) {
      try {
        let src: string | null = null;
        for (const rootRel of plugin.skillsRootPaths) {
          src = await resolveContainedReal(plugin.rootDir, `${rootRel.replace(/\/\*$/, '')}/${skillName}/SKILL.md`);
          if (src) break;
        }
        if (!src) continue;
        out.push({ pluginId: plugin.id, skillName, content: await readFile(src, 'utf8') });
      } catch (err) {
        log?.(`collectPluginAgentsSkills:${plugin.id}`, err);
      }
    }
  }
  return out;
}

export async function applyPluginAgentCapabilities(
  contributors: readonly PluginAgentSyncInput[],
  log?: (context: string, err: unknown) => void
): Promise<void> {
  rebuildPluginServers(contributors);
  await syncPluginSkills(contributors, log);
  try {
    await reconcilePluginAgentsSkills({ entries: await collectPluginAgentsSkills(contributors, log), log });
  } catch (err) {
    log?.('applyPluginAgentCapabilities:agentsSkills', err);
  }
}
