import { basename, join } from 'node:path';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { createModernTeamLaunchSource, type ModernTeamLaunchConfig, type ModernTeamLaunchSourceDeps } from './modern-team-launch-tools.js';
import { readMcpPort } from '../mcp/mcp-port-store.js';

export interface ModernTeamLaunchConfigSourceOptions {
  getAppConfig: () => Pick<AppConfig, 'teamLaunchEnabled' | 'teamJobLaunchEnabled' | 'composerShowAutonomousTeam'>;
  getMcpBaseUrl: () => string | undefined;
  resolveMember?: ModernTeamLaunchSourceDeps['resolveMember'];
}

export function mcpPortFileForDataDir(dataDir: string, userDataDir?: string): string {
  const expectedName = basename(dataDir) === '.zcc' ? 'mcp-port.json' : 'mcp-port-dev.json';
  const root = userDataDir ?? join(dataDir, 'electron-user-data');
  return join(root, expectedName);
}

export function createModernTeamLaunchConfigSource(options: ModernTeamLaunchConfigSourceOptions) {
  return createModernTeamLaunchSource({
    resolveMember: options.resolveMember,
    getConfig: (): ModernTeamLaunchConfig => {
      const config = options.getAppConfig();
      return {
        mcpBaseUrl: options.getMcpBaseUrl(),
        teamLaunchEnabled: config.teamLaunchEnabled === true,
        teamJobLaunchEnabled: config.teamJobLaunchEnabled !== false || config.composerShowAutonomousTeam !== false
      };
    }
  });
}

export function standaloneModernTeamLaunchSource(
  dataDir: string,
  getAppConfig: ModernTeamLaunchConfigSourceOptions['getAppConfig'],
  userDataDir?: string,
  resolveMember?: ModernTeamLaunchSourceDeps['resolveMember']
) {
  return createModernTeamLaunchConfigSource({
    getAppConfig,
    resolveMember,
    getMcpBaseUrl: () => {
      const port = readMcpPort(mcpPortFileForDataDir(dataDir, userDataDir));
      return port ? `http://127.0.0.1:${port}` : undefined;
    }
  });
}
