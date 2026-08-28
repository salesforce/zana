import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createPrMonitorPlugin, type PrMonitorPluginDeps } from './lib/plugin.js';

export default async function plugin(zcc: ZccPluginApi, deps?: PrMonitorPluginDeps): Promise<void> {
  await createPrMonitorPlugin(zcc, deps);
}
