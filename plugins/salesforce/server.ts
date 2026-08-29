import type { ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { createSalesforcePlugin } from './lib/plugin.js';

export default async function plugin(zcc: ZccPluginApi): Promise<void> {
  await createSalesforcePlugin(zcc);
}
