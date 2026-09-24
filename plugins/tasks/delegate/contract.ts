import { defineRpcContract } from "../compat/server";
import { z } from "zod";
import { idSchema } from "../shared/contract";

const threadIdSchema = z.string().min(1);

export const delegationRpcContract = defineRpcContract({
  delegate: {
    input: z
      .object({
        taskId: idSchema,
        presetId: idSchema,
        extraInstructions: z.string().optional(),
      })
      .strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  taskThreadsAttach: {
    input: z.object({ taskId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
  taskThreadsDetach: {
    input: z.object({ taskId: idSchema, threadId: threadIdSchema }).strict(),
    output: z.object({ threadId: threadIdSchema }).strict(),
  },
});

export type DelegationRpcContract = typeof delegationRpcContract;
