import { describe, expect, it } from "vitest";
import type { TimelineRow } from "@zana-ai/zcc-server-contract";
import { createTimelineEventFactory, renderTimelineFixture } from "./timeline-test-harness.js";

const WORKSPACE = "/Users/dev/project";
const ATTACHMENTS = "/Users/dev/.zcc/attachments/p1";

type ConversationRow = Extract<TimelineRow, { kind: "conversation" }>;
function conversations(rows: readonly TimelineRow[]): ConversationRow[] {
  return rows.flatMap((row) => {
    if (row.kind === "conversation") return [row];
    const nested = [
      ...(("children" in row && row.children) || []),
      ...(("childRows" in row && (row as { childRows?: TimelineRow[] }).childRows) || []),
    ] as TimelineRow[];
    return conversations(nested);
  });
}

function render(text: string, opts: { workspaceRoot?: string; previewRoots?: string[] }) {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  const rendered = renderTimelineFixture({
    events: [
      event.turnStarted({ turnId: "turn-1", createdAt: 0 }),
      event.providerUserMessage({ turnId: "turn-1", text, createdAt: 1_000 }),
      event.assistantCompleted({ turnId: "turn-1", text, createdAt: 2_000 }),
      event.turnCompleted({ turnId: "turn-1", createdAt: 3_000 }),
    ],
    projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    ...opts,
  });
  return conversations(rendered.rows);
}

describe("conversation previewRoots", () => {
  it("attaches workspace and extra roots when the text names an absolute path", () => {
    const rows = render("see /Users/dev/project/notes.md", { workspaceRoot: WORKSPACE, previewRoots: [ATTACHMENTS] });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(new Set(row.previewRoots)).toEqual(new Set([WORKSPACE, ATTACHMENTS]));
  });

  it.each([
    ["backtick-quoted", "open `/etc/hosts` now"],
    ["parenthesised", "file (/tmp/a.md)"],
    ["bracketed", "[x] /tmp/a.md"],
    ["file URL", "file:///tmp/a.md"],
    ["line start", "/tmp/a.md"],
  ])("detects %s absolute paths", (_name, text) => {
    for (const row of render(text, { workspaceRoot: WORKSPACE })) expect(new Set(row.previewRoots)).toEqual(new Set([WORKSPACE]));
  });

  it.each([
    ["plain text", "hello world"],
    ["relative path", "see src/notes.md"],
    ["bare slash", "a / b and 5/3"],
    ["lone slash", "ratio / done"],
  ])("omits previewRoots for %s", (_name, text) => {
    const rows = render(text, { workspaceRoot: WORKSPACE, previewRoots: [ATTACHMENTS] });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect("previewRoots" in row).toBe(false);
  });

  it("omits previewRoots when there are no roots at all", () => {
    for (const row of render("/tmp/a.md", {})) expect("previewRoots" in row).toBe(false);
  });

  it("uses only extra roots when there is no workspace", () => {
    for (const row of render("/tmp/a.md", { previewRoots: [ATTACHMENTS] })) expect(new Set(row.previewRoots)).toEqual(new Set([ATTACHMENTS]));
  });
});
