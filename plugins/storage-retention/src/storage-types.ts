import { z } from "zod";

export const HOST_STORAGE_LARGEST_THREADS_LIMIT = 20;

const byteCountSchema = z.number().int().nonnegative();
const countSchema = z.number().int().nonnegative();

export const diskCapacitySchema = z.object({
  totalBytes: byteCountSchema,
  freeBytes: byteCountSchema,
});
export type DiskCapacity = z.infer<typeof diskCapacitySchema>;

export const hostStorageThreadSchema = z.object({
  threadId: z.string(),
  projectId: z.string(),
  title: z.string(),
  archivedAt: z.number().nullable(),
  updatedAt: z.number(),
  running: z.boolean(),
  hidden: z.boolean(),
  pinned: z.boolean(),
  sizeBytes: byteCountSchema,
});
export type HostStorageThread = z.infer<typeof hostStorageThreadSchema>;

export const hostStorageReportSchema = z.object({
  hostId: z.string(),
  scannedAt: z.number(),
  disk: diskCapacitySchema.nullable(),
  activeThreadBytes: byteCountSchema,
  archivedThreadBytes: byteCountSchema,
  orphanBytes: byteCountSchema,
  threadsWithStorageCount: countSchema,
  archivedThreadCount: countSchema,
  orphanCount: countSchema,
  /** Folders too large to walk fully; their sizes are lower bounds. */
  partialCount: countSchema,
  hiddenThreads: z.object({
    activeCount: countSchema,
    activeBytes: byteCountSchema,
    archivedCount: countSchema,
    archivedBytes: byteCountSchema,
  }),
  archivedFiles: z.object({ threadCount: countSchema, bytes: byteCountSchema }),
  archivedLargeFiles: z.object({
    threadCount: countSchema,
    fileCount: countSchema,
    bytes: byteCountSchema,
  }),
  largestThreads: z
    .array(hostStorageThreadSchema)
    .max(HOST_STORAGE_LARGEST_THREADS_LIMIT),
});
export type HostStorageReport = z.infer<typeof hostStorageReportSchema>;

export const hostStorageScanStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("scanning"), startedAt: z.number() }),
  z.object({
    state: z.literal("failed"),
    failedAt: z.number(),
    message: z.string(),
  }),
]);
export type HostStorageScanStatus = z.infer<typeof hostStorageScanStatusSchema>;

export const largeFileCleanupStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("running"), startedAt: z.number() }),
  z.object({
    state: z.literal("completed"),
    clearedFiles: countSchema,
    clearedBytes: byteCountSchema,
  }),
  z.object({ state: z.literal("failed"), message: z.string() }),
]);
export type LargeFileCleanupStatus = z.infer<typeof largeFileCleanupStatusSchema>;

export const archivedFileCleanupStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({
    state: z.literal("running"),
    clearedThreads: countSchema,
    clearedBytes: byteCountSchema,
  }),
  z.object({
    state: z.literal("completed"),
    clearedThreads: countSchema,
    clearedBytes: byteCountSchema,
  }),
  z.object({
    state: z.literal("failed"),
    message: z.string(),
    clearedThreads: countSchema,
    clearedBytes: byteCountSchema,
  }),
]);
export type ArchivedFileCleanupStatus = z.infer<
  typeof archivedFileCleanupStatusSchema
>;

export const maintenanceStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("idle") }),
  z.object({ state: z.literal("running") }),
  z.object({ state: z.literal("completed"), message: z.string() }),
  z.object({ state: z.literal("failed"), message: z.string() }),
]);
export type MaintenanceStatus = z.infer<typeof maintenanceStatusSchema>;

const hostStateShape = {
  report: hostStorageReportSchema.nullable(),
  scan: hostStorageScanStatusSchema,
  largeFileCleanup: largeFileCleanupStatusSchema,
  archivedFileCleanup: archivedFileCleanupStatusSchema,
  maintenance: maintenanceStatusSchema,
};
export const hostStorageResponseSchema = z.object(hostStateShape);
export type HostStorageResponse = z.infer<typeof hostStorageResponseSchema>;

export const hostStorageListResponseSchema = z.object({
  hosts: z.array(
    z.object({
      hostId: z.string(),
      hostName: z.string(),
      ...hostStateShape,
    }),
  ),
});
export type HostStorageListResponse = z.infer<
  typeof hostStorageListResponseSchema
>;

export const hostStorageRemoveOrphansResponseSchema = z.object({
  removedCount: countSchema,
  removedBytes: byteCountSchema,
  skippedCount: countSchema,
  report: hostStorageReportSchema,
});
export type HostStorageRemoveOrphansResponse = z.infer<
  typeof hostStorageRemoveOrphansResponseSchema
>;
