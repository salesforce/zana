import os from "node:os";
import { experimental_defineHostEntry } from "@zana-ai/zcc-plugin-sdk/host";
import { experimental_probeAcpAgent } from "@zana-ai/zcc-plugin-sdk/provider-bridge/acp";
import { acpHostContract } from "./contract.js";
import { resolveAcpNativeRoots } from "./native-roots/index.js";

export { experimental_acpProviderBridge as experimental_providerBridge } from "@zana-ai/zcc-plugin-sdk/provider-bridge/acp";

export default experimental_defineHostEntry({
  contract: acpHostContract,
  handlers: {
    probeAgent: async (input, context) =>
      experimental_probeAcpAgent({
        command: input.command,
        args: input.args,
        env: input.env,
        cwd: context.experimental_paths.tempDir,
      }),
    resolveNativeRoots: (input) =>
      resolveAcpNativeRoots({
        agentId: input.providerId,
        cwd: input.cwd,
        homeDir: os.homedir(),
        env: process.env,
      }),
  },
});
