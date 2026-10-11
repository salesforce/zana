import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk";
import type { z } from "zod";
import { z as zod } from "zod";
import { hostStorageContract } from "./host-contract.js";
import {
  ARCHIVE_GRACE_MS,
  LARGE_FILE_MIN_BYTES,
  ORPHAN_MIN_AGE_MS,
} from "./rules.js";
import { isLive, readThreads, toStorageThread, type StorageThread } from "./sdk-data.js";
import { isStorageEntry, isThreadEntry } from "./storage-entry.js";
import {
  diskCapacitySchema,
  type ArchivedFileCleanupStatus,
  type HostStorageReport,
  type HostStorageResponse,
  type HostStorageScanStatus,
  type LargeFileCleanupStatus,
  type MaintenanceStatus,
} from "./storage-types.js";

type Contract = typeof hostStorageContract;
type Method = keyof Contract;

/** How many folders the server asks a machine to list, measure and discard at once. */
const LAYOUT_PAGE = 5_000;
const MEASURE_BATCH = 50;
const DISCARD_BATCH = 100;
const LARGE_FILE_BATCH = 10;
const MAX_STORAGE_FOLDERS = 2_000_000;
const MEASURE_BUDGET_MS = 60_000;
const MAX_FILES_PER_FOLDER = 2_000_000;
/** Longest the server waits on one machine call (the plugin host's own ceiling). */
const LAYOUT_TIMEOUT_MS = 60_000;
const MEASURE_TIMEOUT_MS = 180_000;
const DISCARD_TIMEOUT_MS = 120_000;
const LARGE_FILE_TIMEOUT_MS = 300_000;
/** A queued clear-on-archive older than this is dropped; the retention policy is the backstop. */
const QUEUE_RETENTION_MS = 7 * 86_400_000;
/** Queued clear-on-archive entries one drain looks at. */
const QUEUE_DRAIN_LIMIT = 500;

const cachedScanSchema = zod.object({
  scannedAt: zod.number(),
  disk: diskCapacitySchema.nullable().default(null),
  largeFiles: zod
    .array(
      zod.object({
        name: zod.string(),
        sizeBytes: zod.number().int().nonnegative(),
        count: zod.number().int().nonnegative(),
      }),
    )
    .default([]),
  entries: zod.array(
    zod.object({
      name: zod.string(),
      sizeBytes: zod.number().int().nonnegative(),
      partial: zod.boolean().default(false),
    }),
  ),
});
type Scan = z.infer<typeof cachedScanSchema>;
interface Removal {
  /** Folders whose whole contents were cleared. */
  entries: Set<string>;
  /** Folders whose large files were deleted. */
  largeFiles: Set<string>;
}
const emptyRemoval = (): Removal => ({ entries: new Set(), largeFiles: new Set() });

/** `scan` without what a cleanup has already removed. */
function withoutRemoved(scan: Scan, removal: Removal): Scan {
  const largeBytes = new Map(scan.largeFiles.map((entry) => [entry.name, entry.sizeBytes]));
  return {
    ...scan,
    entries: scan.entries
      .filter((entry) => !removal.entries.has(entry.name))
      .map((entry) =>
        removal.largeFiles.has(entry.name)
          ? { ...entry, sizeBytes: Math.max(0, entry.sizeBytes - (largeBytes.get(entry.name) ?? 0)) }
          : entry,
      ),
    largeFiles: scan.largeFiles.filter(
      (entry) => !removal.entries.has(entry.name) && !removal.largeFiles.has(entry.name),
    ),
  };
}

/** Archived long enough to be past its undo window, unpinned, and not in use. */
export function clearableArchived(
  thread: Pick<StorageThread, "archivedAt" | "deletedAt" | "pinnedAt" | "status">,
): boolean {
  return (
    thread.archivedAt !== null &&
    thread.deletedAt === null &&
    thread.archivedAt + ARCHIVE_GRACE_MS <= Date.now() &&
    thread.pinnedAt === null &&
    !isLive(thread)
  );
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sumBytes = (entries: readonly { sizeBytes: number }[]) =>
  entries.reduce((total, entry) => total + entry.sizeBytes, 0);
const byThreadId = (threads: readonly StorageThread[]) =>
  new Map(threads.map((thread) => [thread.id.toLowerCase(), thread]));

export function createStorage(zcc: ZccPluginApi) {
  const db = zcc.storage.database();
  db.migrate([
    "CREATE TABLE scans (host_id TEXT PRIMARY KEY, result_json TEXT NOT NULL)",
    "CREATE TABLE archive_cleanup (thread_id TEXT PRIMARY KEY, archived_at INTEGER NOT NULL)",
    "CREATE TABLE cleared (thread_id TEXT PRIMARY KEY, archived_at INTEGER NOT NULL)",
  ]);
  // In the isolated plugin worker this is an async bridge call, and a zod contract
  // cannot cross the bridge, so both directions are validated here instead.
  const client = Promise.resolve(zcc.host.experimental_client());
  void client.catch(() => undefined);
  const lifecycle = new AbortController();
  const busy = new Set<string>();
  const entryClears = new Map<string, { keys: Set<string>; release: () => void }>();
  const maintenance = new Map<string, MaintenanceStatus>();
  const scans = new Map<string, HostStorageScanStatus>();
  const archivedFileCleanups = new Map<string, ArchivedFileCleanupStatus>();
  const largeFileCleanups = new Map<string, LargeFileCleanupStatus>();
  const scanRemovals = new Map<string, Removal>();
  const jobs = new Set<Promise<unknown>>();
  zcc.onDispose(async () => {
    lifecycle.abort();
    await Promise.allSettled(jobs);
  });

  function track<T>(job: Promise<T>): Promise<T> {
    jobs.add(job);
    void job.then(
      () => jobs.delete(job),
      () => jobs.delete(job),
    );
    return job;
  }
  const changed = () => {
    if (!lifecycle.signal.aborted) zcc.realtime.publish("changed", null);
  };

  // ---- machine calls -------------------------------------------------------------

  async function callHost<M extends Method>(
    hostId: string,
    method: M,
    input: z.input<Contract[M]["input"]>,
    timeoutMs: number,
  ): Promise<z.output<Contract[M]["output"]>> {
    lifecycle.signal.throwIfAborted();
    const parsed = hostStorageContract[method].input.parse(input);
    const raw = await (await client).call(method, parsed, { hostId, signal: lifecycle.signal, timeoutMs });
    lifecycle.signal.throwIfAborted();
    return hostStorageContract[method].output.parse(raw) as z.output<Contract[M]["output"]>;
  }

  async function machines() {
    lifecycle.signal.throwIfAborted();
    return zcc.sdk.hosts.list({ signal: lifecycle.signal });
  }
  async function requireHost(hostId: string) {
    const known = await machines();
    if (!known.some((machine) => machine.id === hostId)) throw new Error("Unknown machine");
  }

  // ---- cached scans ----------------------------------------------------------------

  function read(hostId: string): Scan | null {
    const row = db.prepare("SELECT result_json FROM scans WHERE host_id = ?").get(hostId) as
      | { result_json: string }
      | undefined;
    if (!row) return null;
    try {
      return cachedScanSchema.parse(JSON.parse(row.result_json));
    } catch (error) {
      // A cache this plugin cannot read is a scan that never happened: rescan to rebuild it.
      zcc.log.warn(`Discarding unreadable storage scan for ${hostId}: ${messageOf(error)}`);
      db.prepare("DELETE FROM scans WHERE host_id = ?").run(hostId);
      return null;
    }
  }
  function store(hostId: string, scan: Scan) {
    db.prepare(
      "INSERT INTO scans (host_id, result_json) VALUES (?, ?) ON CONFLICT(host_id) DO UPDATE SET result_json = excluded.result_json",
    ).run(hostId, JSON.stringify(scan));
    changed();
  }
  /**
   * Drop cleared storage from the cached scan, and from the scan still in flight:
   * a scan that measured a folder before it was cleared must not bring it back.
   */
  function forget(hostId: string, removed: Partial<Removal>) {
    const removal: Removal = {
      entries: removed.entries ?? new Set(),
      largeFiles: removed.largeFiles ?? new Set(),
    };
    const pending = scanRemovals.get(hostId);
    if (pending) {
      for (const name of removal.entries) pending.entries.add(name);
      for (const name of removal.largeFiles) pending.largeFiles.add(name);
    }
    const cached = read(hostId);
    if (cached) store(hostId, withoutRemoved(cached, removal));
  }

  // ---- reports -----------------------------------------------------------------------

  function report(hostId: string, scan: Scan, threads: readonly StorageThread[]): HostStorageReport {
    const byId = byThreadId(threads);
    const owned = scan.entries.flatMap((entry) => {
      const thread = byId.get(entry.name.toLowerCase());
      return thread ? [{ ...entry, thread }] : [];
    });
    const orphans = scan.entries.filter((entry) => !byId.has(entry.name.toLowerCase()));
    const archived = owned.filter((entry) => entry.thread.archivedAt !== null);
    const hiddenActive = owned.filter(
      (entry) => entry.thread.visibility === "hidden" && entry.thread.archivedAt === null,
    );
    const hiddenArchived = archived.filter((entry) => entry.thread.visibility === "hidden");
    // A thread cleared since it was archived has nothing left to clear.
    const cleared = clearedArchives();
    const clearable = owned.filter(
      (entry) =>
        clearableArchived(entry.thread) && cleared.get(entry.thread.id) !== entry.thread.archivedAt,
    );
    const clearableLarge = scan.largeFiles.filter((entry) => {
      const thread = byId.get(entry.name.toLowerCase());
      return thread !== undefined && clearableArchived(thread);
    });
    return {
      hostId,
      scannedAt: scan.scannedAt,
      disk: scan.disk,
      activeThreadBytes: sumBytes(owned.filter((entry) => entry.thread.archivedAt === null)),
      archivedThreadBytes: sumBytes(archived),
      orphanBytes: sumBytes(orphans),
      threadsWithStorageCount: owned.length,
      archivedThreadCount: archived.length,
      orphanCount: orphans.length,
      partialCount: scan.entries.filter((entry) => entry.partial).length,
      hiddenThreads: {
        activeCount: hiddenActive.length,
        activeBytes: sumBytes(hiddenActive),
        archivedCount: hiddenArchived.length,
        archivedBytes: sumBytes(hiddenArchived),
      },
      archivedFiles: { threadCount: clearable.length, bytes: sumBytes(clearable) },
      archivedLargeFiles: {
        threadCount: clearableLarge.length,
        fileCount: clearableLarge.reduce((total, entry) => total + entry.count, 0),
        bytes: sumBytes(clearableLarge),
      },
      largestThreads: [...owned]
        .sort((a, b) => b.sizeBytes - a.sizeBytes)
        .slice(0, 20)
        .map(({ thread, sizeBytes }) => ({
          threadId: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          archivedAt: thread.archivedAt,
          updatedAt: thread.updatedAt,
          hidden: thread.visibility === "hidden",
          pinned: thread.pinnedAt !== null,
          running: isLive(thread),
          sizeBytes,
        })),
    };
  }

  /** One thread listing, shared by every report built for one request. */
  function sharedThreads() {
    let pending: Promise<StorageThread[]> | null = null;
    return () => (pending ??= readThreads(zcc, lifecycle.signal));
  }

  async function hostResponse(
    hostId: string,
    threads: () => Promise<StorageThread[]>,
  ): Promise<HostStorageResponse> {
    // Read the cached report and every status in one synchronous step, so they
    // describe the same moment even though the thread listing is awaited.
    const cached = read(hostId);
    const status = {
      maintenance: maintenance.get(hostId) ?? ({ state: "idle" } as const),
      scan: scans.get(hostId) ?? ({ state: "idle" } as const),
      largeFileCleanup: largeFileCleanups.get(hostId) ?? ({ state: "idle" } as const),
      archivedFileCleanup: archivedFileCleanups.get(hostId) ?? ({ state: "idle" } as const),
    };
    return { ...status, report: cached ? report(hostId, cached, await threads()) : null };
  }
  async function host({ hostId }: { hostId: string }): Promise<HostStorageResponse> {
    await requireHost(hostId);
    return hostResponse(hostId, sharedThreads());
  }
  async function hosts() {
    const known = await machines();
    const threads = sharedThreads();
    return {
      hosts: await Promise.all(
        known.map(async (machine) => ({
          hostId: machine.id,
          hostName: machine.name,
          ...(await hostResponse(machine.id, threads)),
        })),
      ),
    };
  }

  // ---- locks -------------------------------------------------------------------------

  function acquire(hostId: string) {
    if (busy.has(hostId))
      throw new Error("Storage maintenance is already running on this machine");
    busy.add(hostId);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      busy.delete(hostId);
    };
  }
  /** Reserve individual folders; different folders of one machine clear together, a cleanup of the whole machine excludes them. */
  function acquireEntries(hostId: string, keys: string[], duplicateMessage: string) {
    const existing = entryClears.get(hostId);
    if (existing && keys.some((key) => existing.keys.has(key))) throw new Error(duplicateMessage);
    const group = existing ?? { keys: new Set<string>(), release: acquire(hostId) };
    entryClears.set(hostId, group);
    for (const key of keys) group.keys.add(key);
    return () => {
      for (const key of keys) group.keys.delete(key);
      if (group.keys.size === 0) {
        entryClears.delete(hostId);
        group.release();
      }
    };
  }

  // ---- scanning ----------------------------------------------------------------------

  async function measureMachine(hostId: string): Promise<Scan> {
    const names: string[] = [];
    let disk: Scan["disk"] = null;
    let after: string | null = null;
    for (;;) {
      const page: z.output<Contract["layout"]["output"]> = await callHost(
        hostId,
        "layout",
        { after, limit: LAYOUT_PAGE },
        LAYOUT_TIMEOUT_MS,
      );
      if (after === null) disk = page.disk;
      names.push(...page.names.filter(isStorageEntry));
      if (names.length > MAX_STORAGE_FOLDERS)
        throw new Error(`Too many thread-storage folders (over ${MAX_STORAGE_FOLDERS}) to scan`);
      if (page.next === null) break;
      if (page.next === after)
        throw new Error("The machine returned a folder listing that does not advance");
      after = page.next;
    }
    const entries: Scan["entries"] = [];
    const largeFiles: Scan["largeFiles"] = [];
    const queue = [...new Set(names)];
    while (queue.length > 0) {
      const batch = queue.splice(0, MEASURE_BATCH);
      const asked = new Set(batch);
      const result = await callHost(
        hostId,
        "measureEntries",
        {
          names: batch,
          budgetMs: MEASURE_BUDGET_MS,
          maxFilesPerEntry: MAX_FILES_PER_FOLDER,
          largeFileMinBytes: LARGE_FILE_MIN_BYTES,
        },
        MEASURE_TIMEOUT_MS,
      );
      const measured = result.entries.filter((entry) => asked.has(entry.name));
      const missing = result.missing.filter((name) => asked.has(name));
      if (measured.length === 0 && missing.length === 0)
        throw new Error("The machine made no progress measuring thread storage");
      for (const entry of measured) {
        entries.push({ name: entry.name, sizeBytes: entry.sizeBytes, partial: entry.partial });
        if (entry.largeCount > 0)
          largeFiles.push({ name: entry.name, sizeBytes: entry.largeBytes, count: entry.largeCount });
      }
      // Folders the machine had no time for go to the front of the next batch.
      queue.unshift(...result.skipped.filter((name) => asked.has(name)));
    }
    return { scannedAt: Date.now(), disk, largeFiles, entries };
  }

  async function scanHost({ hostId }: { hostId: string }) {
    await requireHost(hostId);
    if (scans.get(hostId)?.state === "scanning") return host({ hostId });
    const removal = emptyRemoval();
    scanRemovals.set(hostId, removal);
    scans.set(hostId, { state: "scanning", startedAt: Date.now() });
    changed();
    track(
      (async () => {
        try {
          const scan = await measureMachine(hostId);
          lifecycle.signal.throwIfAborted();
          scans.delete(hostId);
          store(hostId, withoutRemoved(scan, removal));
        } catch (error) {
          if (!lifecycle.signal.aborted) {
            scans.set(hostId, { state: "failed", failedAt: Date.now(), message: messageOf(error) });
            changed();
          }
        } finally {
          if (scanRemovals.get(hostId) === removal) scanRemovals.delete(hostId);
        }
      })(),
    );
    return host({ hostId });
  }

  async function scanAll() {
    for (const machine of await machines())
      if (scans.get(machine.id)?.state !== "scanning") await scanHost({ hostId: machine.id });
    return hosts();
  }

  // ---- clearing whole folders ------------------------------------------------------------

  const clearedArchives = () =>
    new Map(
      (db.prepare("SELECT thread_id, archived_at FROM cleared").all() as Array<{
        thread_id: string;
        archived_at: number;
      }>).map((row) => [row.thread_id, row.archived_at]),
    );
  function markCleared(threadId: string, archivedAt: number) {
    db.prepare(
      "INSERT INTO cleared (thread_id, archived_at) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET archived_at = excluded.archived_at",
    ).run(threadId, archivedAt);
  }
  /** Forget clears for threads that are no longer archived the way they were. */
  function pruneCleared(threads: readonly Pick<StorageThread, "id" | "archivedAt">[]) {
    const current = new Map(threads.map((thread) => [thread.id, thread.archivedAt]));
    db.transaction(() => {
      for (const [threadId, archivedAt] of clearedArchives())
        if (current.get(threadId) !== archivedAt)
          db.prepare("DELETE FROM cleared WHERE thread_id = ?").run(threadId);
    });
  }

  /**
   * Clear the named folders in batches, rechecking each batch against the thread
   * table as it is now, so a thread that was unarchived, pinned, restarted or
   * claimed since the scan is left alone.
   */
  /**
   * The row each named folder belongs to right now, read by id. A paged list can miss a row deleted while
   * it is read, and acting on that gap would treat a live thread's folder as an orphan; a lookup by id sees
   * every row, hidden ones included. Trash folders never belong to a thread.
   */
  async function rowsFor(names: readonly string[]): Promise<Map<string, StorageThread | null>> {
    const rows = new Map<string, StorageThread | null>();
    for (const name of names) {
      const id = name.toLowerCase();
      if (rows.has(id)) continue;
      lifecycle.signal.throwIfAborted();
      if (!isThreadEntry(name)) {
        rows.set(id, null);
        continue;
      }
      const row = await zcc.sdk.threads.get({ threadId: id });
      rows.set(id, row ? toStorageThread(row) : null);
    }
    return rows;
  }

  async function discard(
    hostId: string,
    entries: Scan["entries"],
    mode:
      | { kind: "orphan" }
      | { kind: "archived"; progress: ((count: number, bytes: number) => void) | null },
  ) {
    let count = 0;
    let skipped = 0;
    let bytes = 0;
    for (let offset = 0; offset < entries.length; offset += DISCARD_BATCH) {
      lifecycle.signal.throwIfAborted();
      const slice = entries.slice(offset, offset + DISCARD_BATCH);
      const current = await rowsFor(slice.map((entry) => entry.name));
      const batch = slice.filter((entry) => {
        const thread = current.get(entry.name.toLowerCase()) ?? null;
        return mode.kind === "orphan" ? thread === null : thread !== null && clearableArchived(thread);
      });
      if (batch.length === 0) continue;
      const result = await callHost(
        hostId,
        "discard",
        {
          names: batch.map((entry) => entry.name),
          // An orphan folder goes away entirely; a thread keeps an empty folder.
          recreate: mode.kind === "archived",
          minAgeMs: mode.kind === "orphan" ? ORPHAN_MIN_AGE_MS : null,
        },
        DISCARD_TIMEOUT_MS,
      );
      const removed = new Set(result.removed);
      forget(hostId, { entries: new Set([...result.removed, ...result.empty]) });
      if (mode.kind === "archived")
        for (const name of [...result.removed, ...result.empty]) {
          const thread = current.get(name.toLowerCase()) ?? null;
          if (thread?.archivedAt != null) markCleared(thread.id, thread.archivedAt);
        }
      count += result.removed.length;
      skipped += result.skipped.length;
      bytes += sumBytes(batch.filter((entry) => removed.has(entry.name)));
      if (mode.kind === "archived") mode.progress?.(count, bytes);
    }
    return { count, skipped, bytes };
  }

  async function removeOrphansOn(hostId: string, release: () => void) {
    try {
      await requireHost(hostId);
      const cached = read(hostId);
      if (!cached) throw new Error("Scan the machine before removing orphaned storage");
      const ids = byThreadId(await readThreads(zcc, lifecycle.signal));
      const removed = await discard(
        hostId,
        cached.entries.filter((entry) => !ids.has(entry.name.toLowerCase())),
        { kind: "orphan" },
      );
      return {
        removedCount: removed.count,
        removedBytes: removed.bytes,
        skippedCount: removed.skipped,
        report: report(
          hostId,
          read(hostId) ?? cached,
          await readThreads(zcc, lifecycle.signal),
        ),
      };
    } finally {
      release();
    }
  }
  async function removeOrphans({ hostId }: { hostId: string }) {
    return removeOrphansOn(hostId, acquire(hostId));
  }
  async function startRemoveOrphans({ hostId }: { hostId: string }) {
    await requireHost(hostId);
    if (!read(hostId)) throw new Error("Scan the machine before cleaning up storage");
    const release = acquire(hostId);
    maintenance.set(hostId, { state: "running" });
    changed();
    track(
      (async () => {
        try {
          const result = await removeOrphansOn(hostId, release);
          maintenance.set(hostId, {
            state: "completed",
            message: `Removed ${result.removedCount} orphaned storage ${result.removedCount === 1 ? "folder" : "folders"}`,
          });
        } catch (error) {
          if (!lifecycle.signal.aborted)
            maintenance.set(hostId, { state: "failed", message: messageOf(error) });
        } finally {
          changed();
        }
      })(),
    );
    return null;
  }

  async function clearArchivedFilesOn(
    hostId: string,
    release: () => void,
    progress: ((count: number, bytes: number) => void) | null,
  ) {
    try {
      const cached = read(hostId);
      if (!cached) throw new Error("Scan the machine before clearing archived thread files");
      const eligible = new Set(
        (await readThreads(zcc, lifecycle.signal))
          .filter(clearableArchived)
          .map((thread) => thread.id.toLowerCase()),
      );
      const removed = await discard(
        hostId,
        cached.entries.filter((entry) => eligible.has(entry.name.toLowerCase())),
        { kind: "archived", progress },
      );
      return { clearedThreads: removed.count, clearedBytes: removed.bytes };
    } finally {
      release();
    }
  }
  async function clearArchivedFiles({ hostId }: { hostId: string }) {
    await requireHost(hostId);
    return clearArchivedFilesOn(hostId, acquire(hostId), null);
  }
  async function startClearArchivedFiles({ hostId }: { hostId: string }) {
    await requireHost(hostId);
    if (!read(hostId)) throw new Error("Scan the machine before clearing archived thread files");
    const release = acquire(hostId);
    let clearedThreads = 0;
    let clearedBytes = 0;
    archivedFileCleanups.set(hostId, { state: "running", clearedThreads, clearedBytes });
    changed();
    track(
      (async () => {
        try {
          const result = await clearArchivedFilesOn(hostId, release, (count, bytes) => {
            clearedThreads = count;
            clearedBytes = bytes;
            archivedFileCleanups.set(hostId, { state: "running", clearedThreads, clearedBytes });
          });
          archivedFileCleanups.set(hostId, { state: "completed", ...result });
        } catch (error) {
          if (!lifecycle.signal.aborted)
            archivedFileCleanups.set(hostId, {
              state: "failed",
              clearedThreads,
              clearedBytes,
              message: messageOf(error),
            });
        } finally {
          changed();
        }
      })(),
    );
    return null;
  }

  // ---- large files ---------------------------------------------------------------------------

  async function clearLargeFilesOn(hostId: string, release: () => void) {
    try {
      await requireHost(hostId);
      const cached = read(hostId);
      if (!cached) throw new Error("Scan the machine before clearing large files");
      const threads = byThreadId(await readThreads(zcc, lifecycle.signal));
      const names = cached.largeFiles
        .filter((entry) => {
          const thread = threads.get(entry.name.toLowerCase());
          return thread !== undefined && clearableArchived(thread);
        })
        .map((entry) => entry.name);
      let fileCount = 0;
      let bytes = 0;
      for (let offset = 0; offset < names.length; offset += LARGE_FILE_BATCH) {
        lifecycle.signal.throwIfAborted();
        const slice = names.slice(offset, offset + LARGE_FILE_BATCH);
        const current = await rowsFor(slice);
        const batch = slice.filter((name) => {
          const thread = current.get(name.toLowerCase()) ?? null;
          return thread !== null && clearableArchived(thread);
        });
        if (batch.length === 0) continue;
        const { removed, skipped } = await callHost(
          hostId,
          "discardLargeFiles",
          { names: batch, minBytes: LARGE_FILE_MIN_BYTES },
          LARGE_FILE_TIMEOUT_MS,
        );
        // A folder the machine could not finish keeps its entry until the next scan.
        const unfinished = new Set(skipped);
        forget(hostId, {
          largeFiles: new Set(removed.map((entry) => entry.name).filter((name) => !unfinished.has(name))),
        });
        for (const entry of removed) {
          fileCount += entry.count;
          bytes += entry.sizeBytes;
        }
      }
      return { fileCount, bytes };
    } finally {
      release();
    }
  }
  /** One named machine, or every machine that has a scan. */
  async function largeFileTargets(hostId: string | null) {
    if (hostId !== null) {
      await requireHost(hostId);
      return [hostId];
    }
    return (await machines()).map((machine) => machine.id).filter((id) => read(id) !== null);
  }
  async function clearLargeFiles({ hostId }: { hostId: string | null }) {
    let clearedFiles = 0;
    let clearedBytes = 0;
    for (const target of await largeFileTargets(hostId)) {
      const cleared = await clearLargeFilesOn(target, acquire(target));
      clearedFiles += cleared.fileCount;
      clearedBytes += cleared.bytes;
    }
    return { clearedFiles, clearedBytes };
  }
  async function startClearLargeFiles({ hostId }: { hostId: string | null }) {
    const candidates = await largeFileTargets(hostId);
    for (const target of candidates)
      if (!read(target)) throw new Error("Scan the machine before clearing large files");
    const eligible = new Set(
      (await readThreads(zcc, lifecycle.signal)).filter(clearableArchived).map((thread) => thread.id.toLowerCase()),
    );
    const targets = candidates.filter((target) =>
      read(target)?.largeFiles.some((entry) => eligible.has(entry.name.toLowerCase())),
    );
    if (targets.some((target) => busy.has(target)))
      throw new Error("Storage maintenance is already running on this machine");
    for (const target of targets) {
      const release = acquire(target);
      largeFileCleanups.set(target, { state: "running", startedAt: Date.now() });
      track(
        (async () => {
          try {
            const result = await clearLargeFilesOn(target, release);
            largeFileCleanups.set(target, {
              state: "completed",
              clearedFiles: result.fileCount,
              clearedBytes: result.bytes,
            });
          } catch (error) {
            if (!lifecycle.signal.aborted)
              largeFileCleanups.set(target, { state: "failed", message: messageOf(error) });
          } finally {
            changed();
          }
        })(),
      );
    }
    changed();
    return null;
  }

  // ---- one thread --------------------------------------------------------------------------------

  type ClearOutcome = { outcome: "removed" | "empty" | "ineligible" };
  /**
   * Empty one thread's storage folder, keeping the folder. With `archivedAt`, only
   * while the thread is still archived at that moment, unpinned and past the
   * undo window; otherwise the user asked for it by name.
   */
  async function clearThreadStorage(
    threadId: string,
    archivedAt: number | null,
  ): Promise<ClearOutcome> {
    lifecycle.signal.throwIfAborted();
    const found = await zcc.sdk.threads.get({ threadId });
    if (!found) throw new Error("Thread not found");
    const thread = toStorageThread(found);
    if (isLive(thread)) throw new Error("Stop the thread before clearing its storage");
    const hostId = thread.hostId;
    await requireHost(hostId);
    const release = acquireEntries(hostId, [thread.id], "This thread’s files are already being cleared");
    try {
      if (archivedAt !== null) {
        const raw = await zcc.sdk.threads.get({ threadId });
        const fresh = raw ? toStorageThread(raw) : null;
        if (!fresh || fresh.archivedAt !== archivedAt || !clearableArchived(fresh))
          return { outcome: "ineligible" };
      }
      const result = await callHost(
        hostId,
        "discard",
        { names: [thread.id], recreate: true, minAgeMs: null },
        DISCARD_TIMEOUT_MS,
      );
      if (result.skipped.length > 0)
        throw new Error("This thread’s folder was left untouched because it is not a plain folder");
      forget(hostId, { entries: new Set([thread.id]) });
      if (archivedAt !== null) markCleared(thread.id, archivedAt);
      return { outcome: result.removed.length > 0 ? "removed" : "empty" };
    } finally {
      release();
    }
  }
  async function clearThread({ threadId }: { threadId: string }) {
    await clearThreadStorage(threadId, null);
    return { ok: true as const };
  }
  const clearArchivedThread = (threadId: string, archivedAt: number) =>
    clearThreadStorage(threadId, archivedAt);

  // ---- clear-on-archive queue --------------------------------------------------------------------

  let drainingArchives = false;
  function queueArchivedStorage(threadId: string, archivedAt: number) {
    db.prepare(
      "INSERT INTO archive_cleanup (thread_id, archived_at) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET archived_at = excluded.archived_at",
    ).run(threadId, archivedAt);
  }
  function cancelArchivedStorage(threadId: string) {
    db.prepare("DELETE FROM archive_cleanup WHERE thread_id = ?").run(threadId);
  }
  async function drainPendingArchives(enabled: () => Promise<boolean>) {
    const pending = db
      .prepare(
        "SELECT thread_id, archived_at FROM archive_cleanup ORDER BY archived_at, thread_id LIMIT ?",
      )
      .all(QUEUE_DRAIN_LIMIT) as Array<{ thread_id: string; archived_at: number }>;
    for (const entry of pending) {
      if (lifecycle.signal.aborted) return;
      if (!(await enabled())) {
        db.prepare("DELETE FROM archive_cleanup").run();
        return;
      }
      if (entry.archived_at < Date.now() - QUEUE_RETENTION_MS) {
        cancelArchivedStorage(entry.thread_id);
        continue;
      }
      try {
        const raw = await zcc.sdk.threads.get({ threadId: entry.thread_id });
        const thread = raw ? toStorageThread(raw) : null;
        if (
          !thread ||
          thread.archivedAt !== entry.archived_at ||
          thread.deletedAt !== null ||
          thread.pinnedAt !== null
        ) {
          cancelArchivedStorage(entry.thread_id);
          continue;
        }
        // Still inside the undo window, or still running: stay queued.
        if (!clearableArchived(thread)) continue;
        await clearThreadStorage(thread.id, entry.archived_at);
        db.prepare("DELETE FROM archive_cleanup WHERE thread_id = ? AND archived_at = ?").run(
          entry.thread_id,
          entry.archived_at,
        );
      } catch (error) {
        zcc.log.warn(`Could not clear archived storage for ${entry.thread_id}: ${messageOf(error)}`);
      }
    }
  }
  /** Clear what is due now; a drain already in progress covers the request. */
  async function clearPendingArchives(enabled: () => Promise<boolean>): Promise<void> {
    if (drainingArchives || lifecycle.signal.aborted) return;
    drainingArchives = true;
    try {
      await track(drainPendingArchives(enabled));
    } finally {
      drainingArchives = false;
    }
  }

  return {
    host,
    hosts,
    scanHost,
    scanAll,
    removeOrphans,
    startRemoveOrphans,
    clearLargeFiles,
    startClearLargeFiles,
    clearArchivedFiles,
    startClearArchivedFiles,
    clearThread,
    clearArchivedThread,
    clearedArchives,
    pruneCleared,
    queueArchivedStorage,
    cancelArchivedStorage,
    clearPendingArchives,
  };
}
export type Storage = ReturnType<typeof createStorage>;
