import { describe, expect, it } from "vitest";
import { selectCandidates, type RetentionThread } from "./policy.js";

const DAY = 86_400_000;
const NOW = 100 * DAY;
function thread(id: string, overrides: Partial<RetentionThread> = {}): RetentionThread {
  return {
    id,
    updatedAt: DAY,
    archivedAt: null,
    pinnedAt: null,
    deletedAt: null,
    parentThreadId: null,
    originKind: null,
    visibility: "visible",
    status: "idle",
    ...overrides,
  };
}
const never = { archiveAfterDays: null, clearAfterDays: null };

describe("archive eligibility", () => {
  it("does nothing under the default Never policy", () => {
    const result = selectCandidates([thread("old"), thread("old-archived", { archivedAt: 1 })], never, NOW);
    expect(result).toEqual({ archive: [], clear: [] });
  });

  it("archives a thread idle for longer than the threshold, oldest first", () => {
    const result = selectCandidates(
      [thread("b", { updatedAt: 2 * DAY }), thread("a", { updatedAt: DAY }), thread("fresh", { updatedAt: NOW - DAY })],
      { archiveAfterDays: 30, clearAfterDays: null },
      NOW,
    );
    expect(result.archive.map((group) => group.rootId)).toEqual(["a", "b"]);
  });

  it("keeps a whole archive group when a spawned child or hidden fork is recent, pinned, or running", () => {
    for (const exemption of [{ updatedAt: NOW }, { pinnedAt: DAY }, { status: "active" }, { status: "starting" }, { status: "stopping" }]) {
      for (const child of [
        { originKind: null, visibility: "hidden" },
        { originKind: "fork", visibility: "hidden" },
        { originKind: null, visibility: "visible" },
      ]) {
        const result = selectCandidates(
          [thread("root"), thread("child", { parentThreadId: "root", ...child, ...exemption }), thread("independent")],
          { archiveAfterDays: 30, clearAfterDays: null },
          NOW,
        );
        expect(result.archive.map((group) => group.rootId), JSON.stringify({ child, exemption })).toEqual(["independent"]);
      }
    }
  });

  it("treats a visible fork as its own thread because archiving its source leaves it live", () => {
    const result = selectCandidates(
      [thread("source"), thread("fork", { parentThreadId: "source", originKind: "fork", visibility: "visible", updatedAt: NOW })],
      { archiveAfterDays: 30, clearAfterDays: null },
      NOW,
    );
    expect(result.archive).toEqual([{ rootId: "source", memberIds: ["source"], oldestAt: DAY }]);
  });

  it("groups children under their root and never lists a child as its own root while the parent is live", () => {
    const result = selectCandidates(
      [thread("root"), thread("child", { parentThreadId: "root" }), thread("grandchild", { parentThreadId: "child", visibility: "hidden" })],
      { archiveAfterDays: 30, clearAfterDays: null },
      NOW,
    );
    expect(result.archive.map((group) => [group.rootId, [...group.memberIds].sort()])).toEqual([["root", ["child", "grandchild", "root"]]]);
  });

  it("promotes a child to its own root once the parent is archived, and skips already archived members", () => {
    const result = selectCandidates(
      [thread("parent", { archivedAt: DAY }), thread("child", { parentThreadId: "parent" }), thread("grand", { parentThreadId: "child" })],
      { archiveAfterDays: 30, clearAfterDays: null },
      NOW,
    );
    expect(result.archive.map((group) => [group.rootId, [...group.memberIds].sort()])).toEqual([["child", ["child", "grand"]]]);
  });

  it("never archives pinned, running, deleted, or recently touched threads, and survives parent cycles", () => {
    const result = selectCandidates(
      [
        thread("pinned", { pinnedAt: 5 }),
        thread("running", { status: "active" }),
        thread("deleted", { deletedAt: DAY }),
        thread("recent", { updatedAt: NOW - DAY }),
        thread("boundary", { updatedAt: NOW - 30 * DAY }),
        thread("loop-a", { parentThreadId: "loop-b" }),
        thread("loop-b", { parentThreadId: "loop-a" }),
      ],
      { archiveAfterDays: 30, clearAfterDays: null },
      NOW,
    );
    expect(result.archive).toEqual([]);
  });

  it("treats a parent that is deleted or missing as no parent at all", () => {
    const result = selectCandidates(
      [thread("orphan-child", { parentThreadId: "gone" }), thread("gone-child", { parentThreadId: "deleted-parent" }), thread("deleted-parent", { deletedAt: 1 })],
      { archiveAfterDays: 30, clearAfterDays: null },
      NOW,
    );
    expect(result.archive.map((group) => group.rootId)).toEqual(["gone-child", "orphan-child"]);
  });
});

describe("clear eligibility", () => {
  it("clears only archived, unpinned, stopped threads archived longer than the threshold, oldest first", () => {
    const result = selectCandidates(
      [
        thread("newer", { archivedAt: 3 * DAY }),
        thread("older", { archivedAt: 2 * DAY }),
        thread("pinned", { archivedAt: DAY, pinnedAt: DAY }),
        thread("recent", { archivedAt: NOW - DAY }),
        thread("live", { archivedAt: DAY, status: "active" }),
        thread("deleted", { archivedAt: DAY, deletedAt: DAY }),
        thread("unarchived"),
      ],
      { archiveAfterDays: null, clearAfterDays: 30 },
      NOW,
    );
    expect(result.clear).toEqual([
      { threadId: "older", archivedAt: 2 * DAY },
      { threadId: "newer", archivedAt: 3 * DAY },
    ]);
    expect(result.archive).toEqual([]);
  });

  it("breaks ties between equally old archives by thread id so batches are stable", () => {
    const result = selectCandidates(
      [thread("b", { archivedAt: DAY }), thread("a", { archivedAt: DAY })],
      { archiveAfterDays: null, clearAfterDays: 1 },
      NOW,
    );
    expect(result.clear.map((entry) => entry.threadId)).toEqual(["a", "b"]);
  });

  it("evaluates both thresholds independently", () => {
    const result = selectCandidates(
      [thread("idle"), thread("archived", { archivedAt: DAY })],
      { archiveAfterDays: 30, clearAfterDays: 30 },
      NOW,
    );
    expect(result.archive.map((group) => group.rootId)).toEqual(["idle"]);
    expect(result.clear.map((entry) => entry.threadId)).toEqual(["archived"]);
  });
});
