import { defineRpcContract } from "@zana-ai/zcc-plugin-sdk";
import { z } from "zod";
import { diskCapacitySchema } from "./storage-types.js";

export const LAYOUT_PAGE_MAX = 20_000;
export const MEASURE_BATCH_MAX = 100;
export const DISCARD_BATCH_MAX = 200;

const storageNames = (max: number) => z.array(z.string().min(1).max(200)).min(1).max(max);
const minBytes = z.number().int().min(1);

export const measuredEntrySchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  /** The walk stopped early or skipped something unreadable: the size is a lower bound. */
  partial: z.boolean(),
  largeCount: z.number().int().nonnegative(),
  largeBytes: z.number().int().nonnegative(),
});
export type MeasuredEntry = z.infer<typeof measuredEntrySchema>;

const largeFileTotalsSchema = z.object({
  name: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
});

/**
 * Everything the plugin does to a machine's disk goes through these methods.
 * The host resolves its own thread-storage root: the server never sends a
 * path, only per-thread folder names, which the host validates strictly.
 */
export const hostStorageContract = defineRpcContract({
  /** Per-thread and leftover-trash folder names under the root, sorted, paged, plus disk capacity. */
  layout: {
    input: z
      .object({ after: z.string().nullable(), limit: z.number().int().min(1).max(LAYOUT_PAGE_MAX) })
      .strict(),
    output: z.object({
      disk: diskCapacitySchema.nullable(),
      names: z.array(z.string()),
      next: z.string().nullable(),
    }),
  },
  /** Measure folders until the time budget is spent; unstarted folders come back as `skipped`. */
  measureEntries: {
    input: z
      .object({
        names: storageNames(MEASURE_BATCH_MAX),
        budgetMs: z.number().int().min(1).max(120_000),
        maxFilesPerEntry: z.number().int().min(1).max(5_000_000),
        largeFileMinBytes: minBytes.nullable(),
      })
      .strict(),
    output: z.object({
      entries: z.array(measuredEntrySchema),
      skipped: z.array(z.string()),
      missing: z.array(z.string()),
    }),
  },
  /** Move folders aside and delete them in the background; optionally leave an empty folder behind. */
  discard: {
    input: z
      .object({
        names: storageNames(DISCARD_BATCH_MAX),
        recreate: z.boolean(),
        /** Skip folders modified more recently than this (guards unknown folders). */
        minAgeMs: z.number().int().min(0).nullable(),
      })
      .strict(),
    output: z.object({
      /** Moved aside and being deleted. */
      removed: z.array(z.string()),
      /** Left alone on purpose: a symbolic link, not a directory, or too recently modified. */
      skipped: z.array(z.string()),
      /** Nothing to clear: the folder is missing, or (when recreating) already empty. */
      empty: z.array(z.string()),
    }),
  },
  /** Delete regular files of at least `minBytes` inside the named thread folders. */
  discardLargeFiles: {
    input: z.object({ names: storageNames(DISCARD_BATCH_MAX), minBytes }).strict(),
    output: z.object({ removed: z.array(largeFileTotalsSchema), skipped: z.array(z.string()) }),
  },
});
