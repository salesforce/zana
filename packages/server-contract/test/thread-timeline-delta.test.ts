import { describe, expect, it } from "vitest";
import {
  applyTimelineDelta,
  computeTimelineRowDelta,
  retainLatestTimelineWindow,
  type TimelineRow,
} from "../src/thread-timeline.js";

function row(id: string, sourceSeqStart: number, title = "t"): TimelineRow {
  return {
    id,
    kind: "system",
    threadId: "thr_x",
    turnId: null,
    sourceSeqStart,
    sourceSeqEnd: sourceSeqStart,
    startedAt: 0,
    createdAt: 0,
    systemKind: "debug",
    title,
    detail: null,
    status: null,
  };
}

describe("timeline delta", () => {
  it("round-trips an upsert + insert (compute then apply equals current)", () => {
    const prev = [row("a", 1), row("b", 2)];
    const current = [row("a", 1), row("b", 2, "changed"), row("c", 3)];
    const delta = computeTimelineRowDelta(prev, current);
    expect(delta.upsertRows.map((r) => r.id)).toEqual(["b", "c"]);
    expect(applyTimelineDelta(prev, delta)).toEqual(current);
  });

  it("round-trips a removal (collapse/eviction)", () => {
    const prev = [row("a", 1), row("b", 2), row("c", 3)];
    const current = [row("a", 1), row("c", 3)];
    const delta = computeTimelineRowDelta(prev, current);
    expect(delta.upsertRows).toHaveLength(0);
    expect(applyTimelineDelta(prev, delta)).toEqual(current);
  });

  it("preserves unchanged row identity (no needless re-render)", () => {
    const a = row("a", 1);
    const prev = [a, row("b", 2)];
    const current = [a, row("b", 2, "changed")];
    const merged = applyTimelineDelta(
      prev,
      computeTimelineRowDelta(prev, current),
    );
    expect(merged?.[0]).toBe(a);
  });

  it("omits row order when membership and ordering are unchanged", () => {
    const prev = [row("a", 1), row("b", 2)];
    const current = [row("a", 1), row("b", 2, "changed")];

    const delta = computeTimelineRowDelta(prev, current);

    expect(delta.rowOrder).toBeUndefined();
    expect(applyTimelineDelta(prev, delta)).toEqual(current);
  });

  it("returns null when the base is stale (id neither held nor sent)", () => {
    expect(
      applyTimelineDelta([row("a", 1)], {
        upsertRows: [],
        rowOrder: ["a", "z"],
      }),
    ).toBeNull();
  });

  it("returns null instead of wiping a filled window with an empty rowOrder", () => {
    expect(
      applyTimelineDelta([row("a", 1)], {
        upsertRows: [],
        rowOrder: [],
      }),
    ).toBeNull();
  });

  it("still applies an empty rowOrder to an already-empty window", () => {
    expect(applyTimelineDelta([], { upsertRows: [], rowOrder: [] })).toEqual([]);
  });
});

describe("retainLatestTimelineWindow", () => {
  it("keeps previous rows when a newer window projects empty", () => {
    const previous = { maxSeq: 10, rows: [row("a", 1)] };
    const next = { maxSeq: 14, rows: [] as TimelineRow[] };
    expect(retainLatestTimelineWindow(previous, next)).toEqual({
      maxSeq: 14,
      rows: previous.rows,
    });
  });

  it("accepts an empty window when maxSeq went backwards", () => {
    const previous = { maxSeq: 10, rows: [row("a", 1)] };
    const next = { maxSeq: 4, rows: [] as TimelineRow[] };
    expect(retainLatestTimelineWindow(previous, next)).toEqual(next);
  });

  it("does not invent rows when the previous window was empty", () => {
    const next = { maxSeq: 2, rows: [] as TimelineRow[] };
    expect(retainLatestTimelineWindow({ maxSeq: 0, rows: [] }, next)).toEqual(next);
    expect(retainLatestTimelineWindow(undefined, next)).toEqual(next);
  });
});
