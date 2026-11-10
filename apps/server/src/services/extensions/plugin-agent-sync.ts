import { rebuildPluginServers, type PluginMcpContributor } from '@zana-ai/zcc-host-daemon/mcp-config';
import { syncPluginSkills, type PluginSkillContributor } from '../skills/skill-installer.js';

export interface PluginAgentSyncInput extends PluginMcpContributor, PluginSkillContributor {}

export async function applyPluginAgentCapabilities(
  contributors: readonly PluginAgentSyncInput[],
  log?: (context: string, err: unknown) => void
): Promise<void> {
  rebuildPluginServers(contributors);
  await syncPluginSkills(contributors, log);
}
