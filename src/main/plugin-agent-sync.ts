import { rebuildPluginServers, type PluginMcpContributor } from './mcp-config.js';
import { syncPluginSkills, type PluginSkillContributor } from './skill-installer.js';

export interface PluginAgentSyncInput extends PluginMcpContributor, PluginSkillContributor {}

export async function applyPluginAgentCapabilities(
  contributors: readonly PluginAgentSyncInput[],
  log?: (context: string, err: unknown) => void
): Promise<void> {
  rebuildPluginServers(contributors);
  await syncPluginSkills(contributors, log);
}
