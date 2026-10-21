import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePluginSessionTools } from '../../plugins/plugin-agent-tools.js';
import { writeMcpPort } from '../mcp/mcp-port-store.js';
import {
  createModernTeamLaunchConfigSource,
  mcpPortFileForDataDir,
  pushedRuntimeAppConfig,
  standaloneModernTeamLaunchSource
} from './modern-team-launch-config.js';

describe('Modern team-launch config source', () => {
  const dirs: string[] = [];
  const session = { threadId: 'thread-1', projectId: 'project-1' };

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('reads pushed utility-process endpoint and gates lazily', async () => {
    let endpoint: string | undefined;
    let teamJobLaunchEnabled = false;
    const source = createModernTeamLaunchConfigSource({
      getMcpBaseUrl: () => endpoint,
      getAppConfig: () => ({ teamLaunchEnabled: false, teamJobLaunchEnabled, composerShowAutonomousTeam: false })
    });

    await expect(resolvePluginSessionTools([source], session)).resolves.toMatchObject({ tools: [] });
    endpoint = 'http://127.0.0.1:43123';
    teamJobLaunchEnabled = true;
    const configured = await resolvePluginSessionTools([source], session);
    expect(configured.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'execution_start',
      'execution_snapshot'
    ]));
  });

  it('uses exactly the flag main pushed to the utility runtime (no hidden composer fallback)', async () => {
    let pushed = { teamLaunchEnabled: false, teamJobLaunchEnabled: false };
    const source = createModernTeamLaunchConfigSource({
      getMcpBaseUrl: () => 'http://127.0.0.1:43123',
      // The pushed payload has no composerShowAutonomousTeam key, as in utility-entry.
      getAppConfig: () => pushedRuntimeAppConfig(pushed)
    });
    const off = await resolvePluginSessionTools([source], session);
    expect(off.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(['squad_propose']));
    expect(off.tools.map((tool) => tool.name)).not.toEqual(expect.arrayContaining(['execution_start']));
    pushed = { teamLaunchEnabled: false, teamJobLaunchEnabled: true };
    const on = await resolvePluginSessionTools([source], session);
    expect(on.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(['squad_propose', 'squad_plan_check', 'list_teams', 'execution_start']));
    expect(pushedRuntimeAppConfig({ teamLaunchEnabled: true, teamJobLaunchEnabled: false })).toEqual({
      teamLaunchEnabled: true, teamJobLaunchEnabled: false, composerShowAutonomousTeam: false
    });
  });

  it('discovers standalone dev MCP port without restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'zcc-modern-tools-'));
    dirs.push(dataDir);
    const source = standaloneModernTeamLaunchSource(dataDir, () => ({
      teamLaunchEnabled: false,
      teamJobLaunchEnabled: true,
      composerShowAutonomousTeam: false
    }));

    await expect(resolvePluginSessionTools([source], session)).resolves.toMatchObject({ tools: [] });
    writeMcpPort(join(dataDir, 'electron-user-data', 'mcp-port-dev.json'), 43_124);
    const configured = await resolvePluginSessionTools([source], session);
    expect(configured.tools.map((tool) => tool.name)).toContain('execution_start');
  });

  it('offers durable Team tools for the default legacy configuration', async () => {
    const source = createModernTeamLaunchConfigSource({
      getMcpBaseUrl: () => 'http://127.0.0.1:43123',
      getAppConfig: () => ({ teamLaunchEnabled: false })
    });
    const configured = await resolvePluginSessionTools([source], session);
    expect(configured.tools.map((tool) => tool.name)).toContain('execution_start');
  });

  it('selects packaged and dev desktop port files from shared data roots', () => {
    expect(mcpPortFileForDataDir('/tmp/.zcc')).toBe('/tmp/.zcc/electron-user-data/mcp-port.json');
    expect(mcpPortFileForDataDir('/tmp/.zcc-dev')).toBe('/tmp/.zcc-dev/electron-user-data/mcp-port-dev.json');
    expect(mcpPortFileForDataDir('/tmp/.zcc', '/tmp/user-data')).toBe('/tmp/user-data/mcp-port.json');
  });

  it('passes async runtime member resolution into role-scoped tools', async () => {
    const source = createModernTeamLaunchConfigSource({
      getMcpBaseUrl: () => 'http://127.0.0.1:43123',
      getAppConfig: () => ({ teamLaunchEnabled: true }),
      resolveMember: async (threadId, projectId) => threadId === session.threadId && projectId === session.projectId
        ? { bindingId: 'binding-1', generation: 1, role: 'worker', executionId: 'execution-1' } : undefined
    });
    const configured = await resolvePluginSessionTools([source], session);
    expect(configured.tools.map((tool) => tool.name)).toContain('execution_work_claim');
    expect(configured.tools.map((tool) => tool.name)).not.toContain('execution_start');
    expect(configured.tools.map((tool) => tool.name)).not.toContain('launch_team');
  });
});
