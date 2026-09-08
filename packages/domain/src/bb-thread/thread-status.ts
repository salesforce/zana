import { z } from "zod";

/**
 * `pending` is the pre-execution status: the thread row exists but no message
 * has ever cleared a dispatch attempt.
 */
export const threadStatusValues = [
  "pending",
  "idle",
  "starting",
  "active",
  "stopping",
  "error",
] as const;
export const threadStatusSchema = z.enum(threadStatusValues);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;
