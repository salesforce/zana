import { z } from 'zod';
import { defineRpcContract } from '@zana-ai/zcc-plugin-sdk';
import { providerUsageResultSchema } from '@zana-ai/zcc-plugin-sdk/provider-bridge';
import { getCodexProviderUsage } from './bridge/provider-maintenance.js';
import os from 'node:os';
import { experimental_defineHostEntry, experimental_nativeRootsHostContract } from '@zana-ai/zcc-plugin-sdk/host';
import { resolveCodexNativeRoots } from './native-roots.js';
export { experimental_providerBridge } from './bridge/bridge.js';
export default experimental_defineHostEntry({
  contract: defineRpcContract({...experimental_nativeRootsHostContract, providerUsage: {input:z.object({}), output:providerUsageResultSchema}}),
  handlers: { providerUsage: () => getCodexProviderUsage(), resolveNativeRoots: () => resolveCodexNativeRoots({ homeDir: os.homedir(), env: process.env }) }
});
