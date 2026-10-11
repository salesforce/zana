import { defineRpcContract } from "@zana-ai/zcc-plugin-sdk";
import { z } from "zod";
import {
  hostStorageListResponseSchema,
  hostStorageRemoveOrphansResponseSchema,
  hostStorageResponseSchema,
} from "./storage-types.js";
import { policySchema, previewSchema, stateSchema } from "./state-types.js";

export * from "./state-types.js";

const machineInput = z.object({ hostId: z.string().min(1) }).strict();
const nullInput = z.null().optional().transform(() => null);
export const storageRpc = defineRpcContract({
  hosts: { input: nullInput, output: hostStorageListResponseSchema },
  host: { input: machineInput, output: hostStorageResponseSchema },
  scanHost: { input: machineInput, output: hostStorageResponseSchema },
  scanAll: { input: nullInput, output: hostStorageListResponseSchema },
  startRemoveOrphans: { input: machineInput, output: z.null() },
  removeOrphans: {
    input: machineInput,
    output: hostStorageRemoveOrphansResponseSchema,
  },
  startClearLargeFiles: {
    input: z.object({ hostId: z.string().min(1).nullable() }).strict(),
    output: z.null(),
  },
  clearLargeFiles: {
    input: z.object({ hostId: z.string().min(1).nullable() }).strict(),
    output: z.object({
      clearedFiles: z.number().int().nonnegative(),
      clearedBytes: z.number().int().nonnegative(),
    }),
  },
  clearThread: {
    input: z.object({ threadId: z.string().min(1) }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  startClearArchivedFiles: { input: machineInput, output: z.null() },
  clearArchivedFiles: {
    input: machineInput,
    output: z.object({
      clearedThreads: z.number().int().nonnegative(),
      clearedBytes: z.number().int().nonnegative(),
    }),
  },
  state: { input: nullInput, output: stateSchema },
  preview: { input: policySchema, output: previewSchema },
  configure: { input: policySchema, output: stateSchema },
});
