import { defineRpcContract } from "@zana-ai/zcc-plugin-sdk";
import { experimental_nativeRootsHostContract } from "@zana-ai/zcc-plugin-sdk/host";
import {
  experimental_acpAgentProbeSchema,
  type AcpAgentProbe,
} from "@zana-ai/zcc-plugin-sdk/provider-bridge/acp";
import { z } from "zod";

export type AcpProbeResult = AcpAgentProbe;

export const acpHostContract = defineRpcContract({
  probeAgent: {
    input: z
      .object({
        command: z.string().min(1),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()),
      })
      .strict(),
    output: experimental_acpAgentProbeSchema,
  },
  ...experimental_nativeRootsHostContract,
});
