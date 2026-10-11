import type { Policy } from "./contract.js";
import { isLive, type StorageThread } from "./sdk-data.js";

export type RetentionThread = Pick<
  StorageThread,
  | "id"
  | "parentThreadId"
  | "originKind"
  | "visibility"
  | "archivedAt"
  | "deletedAt"
  | "pinnedAt"
  | "updatedAt"
  | "status"
>;
export interface ArchiveCandidate {
  rootId: string;
  memberIds: string[];
  oldestAt: number;
}
export interface ClearCandidate {
  threadId: string;
  archivedAt: number;
}

const DAY_MS = 86_400_000;

/** Archiving a parent archives its spawned children and hidden forks, not visible forks. */
const followsParent = (thread: RetentionThread) =>
  thread.parentThreadId !== null &&
  !(thread.originKind === "fork" && thread.visibility === "visible");

export function selectCandidates(
  threads: readonly RetentionThread[],
  policy: Pick<Policy, "archiveAfterDays" | "clearAfterDays">,
  now: number,
): { archive: ArchiveCandidate[]; clear: ClearCandidate[] } {
  const live = threads.filter((thread) => thread.deletedAt === null);
  const byId = new Map(live.map((thread) => [thread.id, thread]));
  const children = new Map<string, RetentionThread[]>();
  for (const thread of live) {
    if (!followsParent(thread)) continue;
    const siblings = children.get(thread.parentThreadId!) ?? [];
    siblings.push(thread);
    children.set(thread.parentThreadId!, siblings);
  }
  const activeParent = (thread: RetentionThread) =>
    followsParent(thread) &&
    byId.get(thread.parentThreadId!)?.archivedAt === null;
  function members(root: RetentionThread) {
    const result: RetentionThread[] = [];
    const seen = new Set<string>();
    const pending = [root];
    while (pending.length > 0) {
      const thread = pending.pop()!;
      if (seen.has(thread.id)) continue;
      seen.add(thread.id);
      result.push(thread);
      pending.push(...(children.get(thread.id) ?? []));
    }
    return result;
  }

  const archive: ArchiveCandidate[] = [];
  if (policy.archiveAfterDays !== null) {
    const cutoff = now - policy.archiveAfterDays * DAY_MS;
    for (const root of live) {
      if (root.archivedAt !== null || activeParent(root)) continue;
      const group = members(root).filter((thread) => thread.archivedAt === null);
      if (
        group.every(
          (thread) =>
            thread.updatedAt < cutoff &&
            thread.pinnedAt === null &&
            !isLive(thread),
        )
      )
        archive.push({
          rootId: root.id,
          memberIds: group.map((thread) => thread.id),
          oldestAt: group.reduce(
            (latest, thread) => Math.max(latest, thread.updatedAt),
            0,
          ),
        });
    }
  }

  const clear: ClearCandidate[] = [];
  if (policy.clearAfterDays !== null) {
    const cutoff = now - policy.clearAfterDays * DAY_MS;
    for (const thread of live)
      if (
        thread.archivedAt !== null &&
        thread.archivedAt < cutoff &&
        thread.pinnedAt === null &&
        !isLive(thread)
      )
        clear.push({ threadId: thread.id, archivedAt: thread.archivedAt });
  }

  archive.sort((a, b) => a.oldestAt - b.oldestAt || a.rootId.localeCompare(b.rootId));
  clear.sort((a, b) => a.archivedAt - b.archivedAt || a.threadId.localeCompare(b.threadId));
  return { archive, clear };
}
