import { z } from 'zod';
import { defineRpcContract, experimental_defineHostEntry } from '@zana-ai/zcc-plugin-sdk/host';

const inspectContextOutputSchema = z.object({
  workspaceKind: z.enum(['workspace', 'host', 'thread-storage', 'unknown']),
  rootBasename: z.string().nullable(),
  pid: z.number()
});

const slowProbeInputSchema = z.object({
  delayMs: z.number().int().min(0).max(10_000)
});

const slowProbeOutputSchema = z.object({
  completed: z.boolean(),
  elapsedMs: z.number()
});

export const platformHooksProbeHostContract = defineRpcContract({
  inspectContext: {
    // The wire protocol JSON-round-trips a missing input to `null`, never
    // `undefined` — z.undefined() rejects every real call through the host
    // RPC boundary even though direct SDK-fake tests (which skip the JSON
    // hop) never catch it.
    input: z.null(),
    output: inspectContextOutputSchema
  },
  slowProbe: {
    input: slowProbeInputSchema,
    output: slowProbeOutputSchema
  }
});

export default experimental_defineHostEntry({
  contract: platformHooksProbeHostContract,
  handlers: {
    inspectContext: (_input, ctx) => ({
      workspaceKind: 'workspace' as const,
      rootBasename: ctx.experimental_paths.projectRoot?.split(/[\\/]/).pop() ?? null,
      pid: process.pid
    }),
    slowProbe: async (input, ctx) => {
      const start = Date.now();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, input.delayMs);
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('slowProbe cancelled'));
        });
      });
      return { completed: true, elapsedMs: Date.now() - start };
    }
  }
});
