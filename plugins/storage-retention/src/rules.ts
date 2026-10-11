/** Files at or above this allocated size are "large files" for cleanup. */
export const LARGE_FILE_MIN_BYTES = 10 * 1024 * 1024;
/** Cached large files below this total are not worth a nudge in the UI. */
export const LARGE_FILE_NUDGE_MIN_BYTES = 1024 * 1024 * 1024;
/** An archive is undoable for this long; cleanup waits it out. */
export const ARCHIVE_GRACE_MS = 30_000;
/** Upper bound of threads one hourly sweep archives. */
export const ARCHIVE_BATCH_LIMIT = 50;
/** Upper bound of threads one hourly sweep clears (cheap: one rename each). */
export const CLEAR_BATCH_LIMIT = 200;
/** An unknown storage folder must be this old before it is called an orphan. */
export const ORPHAN_MIN_AGE_MS = 10 * 60_000;
/** Threads the plugin will read before failing closed instead of acting on a partial view. */
export const THREAD_READ_CAP = 200_000;
/** Thread statuses that mean a runtime may still be using the thread's storage. */
export const LIVE_STATUSES: readonly string[] = ["starting", "active", "stopping"];
