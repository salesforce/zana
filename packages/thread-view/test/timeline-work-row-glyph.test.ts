import { describe, expect, it } from "vitest";
import { workRowGlyph, activityIntentTitleGlyph } from "../src/timeline-work-row-glyph.js";
import type { TimelineViewWorkRow } from "../src/timeline-view.js";
import type { TimelineActivityIntentTitle } from "../src/timeline-row-title.js";

const base = {
  id: "w1",
  threadId: "t1",
  turnId: "turn",
  sourceSeqStart: 1,
  sourceSeqEnd: 1,
  startedAt: 1,
  createdAt: 1,
  kind: "work" as const,
  status: "completed" as const,
  callId: "c1",
};

describe("workRowGlyph", () => {
  it("uses FileText for a Read exploration tool", () => {
    const row: TimelineViewWorkRow = {
      ...base,
      workKind: "tool",
      toolName: "Read",
      toolArgs: { path: "foo.ts" },
      output: "",
      completedAt: 2,
      approvalStatus: null,
      activityIntents: [{ type: "read", command: "Read", name: "foo.ts", path: "foo.ts" }],
    };
    expect(workRowGlyph(row)).toBe("FileText");
  });

  it("prefers the bridge glyph when it is a host name", () => {
    const row: TimelineViewWorkRow = {
      ...base,
      workKind: "tool",
      toolName: "Read",
      toolArgs: null,
      output: "",
      completedAt: 2,
      approvalStatus: null,
      activityIntents: [],
      presentation: {
        label: { pending: "Reading", completed: "Read" },
        icon: { glyph: "FileText" },
      },
    };
    expect(workRowGlyph(row)).toBe("FileText");
  });

  it("uses FileText, Search, ListTodo, and Puzzle for dedicated kinds", () => {
    expect(workRowGlyph({
      ...base,
      workKind: "file-read",
      path: "a.ts",
      cmd: null,
      completedAt: 2,
    })).toBe("FileText");
    expect(workRowGlyph({
      ...base,
      workKind: "search",
      mode: "content",
      query: "foo",
      path: null,
      cmd: null,
      completedAt: 2,
    })).toBe("Search");
    expect(workRowGlyph({
      ...base,
      workKind: "plan-steps",
      steps: [{ step: "One" }],
      explanation: null,
      completedAt: 2,
    })).toBe("ListTodo");
    expect(workRowGlyph({
      ...base,
      workKind: "extension",
      extensionKind: "demo/card",
      payload: {},
      completedAt: 2,
      presentation: {
        label: { pending: "Showing", completed: "Showed" },
        icon: { glyph: "Puzzle" },
      },
    })).toBe("Puzzle");
  });

  it("uses Zap for a SKILL.md read intent", () => {
    const entry: TimelineActivityIntentTitle = {
      id: "i1",
      intentType: "read",
      intent: { type: "read", command: "Read", name: "SKILL.md", path: "skills/foo/SKILL.md" },
      title: { segments: [], decorations: [], tone: "default", action: null, plain: "" },
    };
    expect(activityIntentTitleGlyph(entry)).toBe("Zap");
  });
});
