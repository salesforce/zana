import { z } from "zod";

const daysSchema = z.number().int().min(1).max(3650).nullable();
export const policySchema = z
  .object({
    /** Archive threads (and the children archiving them takes along) idle this long. */
    archiveAfterDays: daysSchema,
    /** Clear the stored files of threads archived this long. The threads stay. */
    clearAfterDays: daysSchema,
    /** Clear a thread's stored files shortly after it is archived. */
    clearStorageOnArchive: z.boolean().default(false),
  })
  .strict();
export type Policy = z.infer<typeof policySchema>;
export const runSchema = z.object({
  ranAt: z.number(),
  archivedCount: z.number().int().nonnegative(),
  clearedCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
});
export type Run = z.infer<typeof runSchema>;
export const stateSchema = z.object({
  policy: policySchema,
  lastRun: runSchema.nullable(),
});
export type State = z.infer<typeof stateSchema>;
export const previewSchema = z.object({
  archiveCount: z.number().int().nonnegative(),
  clearCount: z.number().int().nonnegative(),
});
export type Preview = z.infer<typeof previewSchema>;
