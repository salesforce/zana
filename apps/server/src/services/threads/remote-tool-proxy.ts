import { join } from 'node:path';
import type { Project } from '@zana-ai/zcc-domain/product';
import { createProjectSettingsStore } from '../../project-settings-store.js';

export function isRemoteToolProxyActive(
  project: Project,
  settings: { remoteToolProxy?: unknown }
): boolean {
  return Boolean(project.remote) && !project.hostId && settings.remoteToolProxy === true;
}

export function readRemoteToolProxySetting(dataDir: string, projectId: string): boolean {
  const store = createProjectSettingsStore({
    projectSettingsFile: join(dataDir, 'project-settings.json')
  });
  return store.get(projectId).remoteToolProxy === true;
}

export function threadLaunchRemote(project: Project): {
  host: string;
  user?: string;
  remotePath?: string;
  proxyJump?: string;
} | undefined {
  if (!project.remote) return undefined;
  return {
    host: project.remote.host,
    ...(project.remote.user ? { user: project.remote.user } : {}),
    ...(project.remote.remotePath ? { remotePath: project.remote.remotePath } : {}),
    ...(project.remote.proxyJump ? { proxyJump: project.remote.proxyJump } : {})
  };
}
