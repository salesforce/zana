import type { ZccPluginApi } from "@zana-ai/zcc-plugin-sdk/server";
import {
  policySchema,
  runSchema,
  type Policy,
  type Preview,
  type Run,
  type State,
} from "./contract.js";
import { selectCandidates } from "./policy.js";
import { ARCHIVE_BATCH_LIMIT, CLEAR_BATCH_LIMIT } from "./rules.js";
import { readThreads } from "./sdk-data.js";
import type { Storage } from "./storage.js";

/** Nothing is archived or cleared until the user opts in. */
const DEFAULT_POLICY: Policy = {
  archiveAfterDays: null,
  clearAfterDays: null,
  clearStorageOnArchive: false,
};

type Clearing = Pick<Storage, "clearArchivedThread" | "clearedArchives" | "pruneCleared">;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createService(zcc: ZccPluginApi, storage: Clearing) {
  const lifecycle = new AbortController();
  const disposed = () => lifecycle.signal.aborted;
  let running = false;
  zcc.onDispose(() => lifecycle.abort());

  function requireActive() {
    if (disposed()) throw new Error("Storage & retention plugin is disabled.");
  }
  /** An unreadable stored policy means every policy is off: never act on a guess. */
  async function readPolicy(): Promise<Policy> {
    const stored = await zcc.storage.kv.get("policy");
    if (stored === null || stored === undefined) return DEFAULT_POLICY;
    const parsed = policySchema.safeParse(stored);
    if (parsed.success) return parsed.data;
    zcc.log.warn("Ignoring an unreadable storage retention policy; all policies are off");
    return DEFAULT_POLICY;
  }
  async function readLastRun(): Promise<Run | null> {
    const parsed = runSchema.safeParse(await zcc.storage.kv.get("lastRun"));
    return parsed.success ? parsed.data : null;
  }
  async function state(): Promise<State> {
    const [policy, lastRun] = await Promise.all([readPolicy(), readLastRun()]);
    return { policy, lastRun };
  }

  /** What `policy` selects against the threads as they are now. */
  async function candidates(policy: Policy) {
    const threads = await readThreads(zcc, lifecycle.signal);
    const selected = selectCandidates(threads, policy, Date.now());
    return { threads, archive: selected.archive, clear: selected.clear };
  }
  /** Archives whose files were already cleared have nothing left to do. */
  function uncleared<T extends { threadId: string; archivedAt: number }>(clear: readonly T[]): T[] {
    const cleared = storage.clearedArchives();
    return clear.filter((entry) => cleared.get(entry.threadId) !== entry.archivedAt);
  }

  async function preview(policy: Policy): Promise<Preview> {
    requireActive();
    const selected = await candidates(policy);
    return {
      archiveCount: new Set(selected.archive.flatMap((group) => group.memberIds)).size,
      clearCount: uncleared(selected.clear).length,
    };
  }
  async function configure(policy: Policy): Promise<State> {
    requireActive();
    await zcc.storage.kv.set("policy", policySchema.parse(policy));
    zcc.realtime.publish("policy-changed", null);
    return state();
  }

  /**
   * Apply the policy once, a bounded batch at a time. Every candidate is
   * checked again against the threads as they are right before it is acted on:
   * the user may have used, pinned or restored it since the list was built.
   */
  async function sweep(): Promise<void> {
    if (running || disposed()) return;
    running = true;
    try {
      const policy = await readPolicy();
      if (policy.archiveAfterDays === null && policy.clearAfterDays === null) return;
      const selected = await candidates(policy);
      storage.pruneCleared(selected.threads);
      const run: Run = { ranAt: Date.now(), archivedCount: 0, clearedCount: 0, failedCount: 0 };
      for (const action of ["archive", "clear"] as const) {
        const batch =
          action === "archive"
            ? selected.archive.slice(0, ARCHIVE_BATCH_LIMIT)
            : uncleared(selected.clear).slice(0, CLEAR_BATCH_LIMIT);
        for (const candidate of batch) {
          if (disposed()) return;
          const current = await readPolicy();
          if (disposed()) return;
          // A policy edited mid-sweep stops the sweep: the rest was chosen under the old one.
          if (
            current.archiveAfterDays !== policy.archiveAfterDays ||
            current.clearAfterDays !== policy.clearAfterDays
          )
            break;
          const subject = "rootId" in candidate ? candidate.rootId : candidate.threadId;
          try {
            if ("rootId" in candidate) {
              const fresh = (await candidates(current)).archive.find(
                (entry) => entry.rootId === candidate.rootId,
              );
              if (disposed()) return;
              if (fresh === undefined) continue;
              await zcc.sdk.threads.archive({ threadId: candidate.rootId });
              run.archivedCount += fresh.memberIds.length;
            } else {
              // Re-reads the thread itself and leaves it alone unless it is still
              // the same archive, unpinned, stopped and past the undo window.
              const result = await storage.clearArchivedThread(
                candidate.threadId,
                candidate.archivedAt,
              );
              if (disposed()) return;
              if (result.outcome === "removed") run.clearedCount += 1;
            }
          } catch (error) {
            if (disposed()) return;
            run.failedCount++;
            zcc.log.warn(`Could not ${action} ${subject}: ${messageOf(error)}`);
          }
        }
      }
      if (!disposed()) {
        await zcc.storage.kv.set("lastRun", run);
        zcc.realtime.publish("changed", null);
      }
    } finally {
      running = false;
    }
  }
  return { state, preview, configure, sweep };
}
export type Service = ReturnType<typeof createService>;
