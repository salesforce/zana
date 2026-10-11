import type {
  PluginSdkThreadSummary,
  ZccPluginApi,
} from "@zana-ai/zcc-plugin-sdk";
import { LIVE_STATUSES, THREAD_READ_CAP } from "./rules.js";

const PAGE = 500;

/** The slice of a thread the plugin reasons about, with every field settled. */
export interface StorageThread {
  id: string;
  projectId: string;
  hostId: string;
  title: string;
  status: string;
  visibility: string;
  originKind: string | null;
  parentThreadId: string | null;
  archivedAt: number | null;
  deletedAt: number | null;
  /**
   * An unknown pin state counts as pinned: a thread the plugin cannot prove
   * unpinned is never archived or cleared.
   */
  pinnedAt: number | null;
  /** Unknown activity counts as just now for the same reason. */
  updatedAt: number;
}

export function toStorageThread(row: PluginSdkThreadSummary): StorageThread {
  return {
    id: row.id,
    projectId: row.projectId,
    hostId: row.hostId,
    title: row.title ?? row.titleFallback ?? row.id,
    status: row.status,
    visibility: row.visibility ?? "visible",
    originKind: row.originKind ?? null,
    parentThreadId: row.parentThreadId ?? null,
    archivedAt: row.archivedAt ?? null,
    deletedAt: row.deletedAt ?? null,
    pinnedAt: row.pinnedAt === undefined ? 0 : row.pinnedAt,
    updatedAt:
      typeof row.updatedAt === "number" ? row.updatedAt : Number.MAX_SAFE_INTEGER,
  };
}

export const isLive = (thread: Pick<StorageThread, "status">) =>
  LIVE_STATUSES.includes(thread.status);

/**
 * Every thread, hidden ones included. Acting on a partial view could mislabel
 * a live thread's storage as an orphan, so an oversized or aborted read throws.
 * The pages are offsets, so a row deleted mid-read can shift another out of
 * view: anything destructive rechecks each folder's thread by id first.
 */
export async function readThreads(
  zcc: ZccPluginApi,
  signal?: AbortSignal,
): Promise<StorageThread[]> {
  const rows: StorageThread[] = [];
  for (let offset = 0; ; offset += PAGE) {
    signal?.throwIfAborted();
    const page = await zcc.sdk.threads.list({
      includeHidden: true,
      limit: PAGE,
      offset,
    });
    for (const row of page) rows.push(toStorageThread(row));
    if (rows.length > THREAD_READ_CAP)
      throw new Error(
        `Too many threads (over ${THREAD_READ_CAP}) to evaluate safely`,
      );
    if (page.length < PAGE) return rows;
  }
}
