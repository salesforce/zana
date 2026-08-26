import { join } from 'node:path';
import {
  createPluginService,
  defaultBundledRoot,
  toPluginAppSnapshot,
  type PluginService,
  type PluginServiceOptions
} from '../plugins/plugin-service.js';
import type { ProductHttpContext } from './product-context.js';

export async function attachProductPluginService(
  ctx: ProductHttpContext,
  opts?: Pick<PluginServiceOptions, 'bundledRoot' | 'onAgentCapabilitiesChanged' | 'onAppsChanged'>
): Promise<PluginService> {
  const plugins = createPluginService({
    dataDir: ctx.dataDir,
    bundledRoot: opts?.bundledRoot ?? defaultBundledRoot(),
    requestPluginInteraction: (args) => ctx.pendingInteractions.requestPluginInteraction(args),
    interruptPluginInteractions: (pluginId) => {
      ctx.pendingInteractions.interruptPluginInteractions(pluginId);
    },
    onAgentCapabilitiesChanged: opts?.onAgentCapabilitiesChanged,
    onAppsChanged: opts?.onAppsChanged
  });
  ctx.plugins = plugins;
  await plugins.start();
  return plugins;
}

export function bundledPluginsRootFromDataDir(dataDir: string, override?: string): string {
  return override ?? join(dataDir, '..', 'plugins');
}

export { toPluginAppSnapshot };
