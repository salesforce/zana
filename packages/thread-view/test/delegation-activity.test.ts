import { describe, expect, it } from "vitest";
import { threadScope, turnScope, type ThreadEvent, type ThreadEventDelegationItem } from "@zana-ai/zcc-domain/thread-runtime";
import { buildThreadTimelineFromEvents, EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT, isBackgroundTaskLifecyclePayload,
  threadActivityFromEvents, type ThreadEventWithMeta } from "../src/index.js";

function entry(type: string, seq: number, fields: object = {}): ThreadEventWithMeta {
  return { event: { type, threadId: "thread", providerThreadId: "provider", scope: turnScope("parent"), ...fields } as ThreadEvent,
    meta: { id: `event-${seq}`, seq, createdAt: seq * 1000 } };
}
function agent(id: string, status: ThreadEventDelegationItem["status"] = "pending", extra = {}): ThreadEventDelegationItem {
  return { type: "delegation", id, childRef: `child-${id}`, label: `Review ${id}`, status, background: false, ...extra };
}
function timeline(events: ThreadEventWithMeta[]) {
  return buildThreadTimelineFromEvents({ acceptedClientRequestContext: EMPTY_ACCEPTED_CLIENT_REQUEST_CONTEXT,
    contextWindowEvents: [], events, options: { includeDebugRawEvents: false, includeNestedRows: true,
      includeProviderUnhandledOperations: false, isLatestPage: true, threadStatus: "idle", threadName: "",
      turnMessageDetail: "full", workspaceRoot: null } });
}
function task(id: string, parentToolCallId: string, extra = {}) {
  return { type: "backgroundTask", id, parentToolCallId, taskType: "local_agent", description: "Native agent",
    status: "pending", taskStatus: "running", skipTranscript: false, ...extra };
}

describe("delegations in existing background activity", () => {
  it("shows all open agents automatically after their parent turn and later replies", () => {
    const events = [entry("turn/started", 1), entry("item/started", 2, { item: agent("a") }),
      entry("item/started", 3, { item: agent("b", "pending", { background: true }) }),
      entry("turn/completed", 4, { status: "completed" }),
      entry("turn/started", 5, { scope: turnScope("later") }),
      entry("turn/completed", 6, { scope: turnScope("later"), status: "completed" })];
    const result = timeline(events);
    expect(result.activeBackgroundCommands.map(row => row.itemId)).toEqual(["b", "a"]);
    expect(result.activeBackgroundCommands[1]).toMatchObject({ description: "Review a", taskType: "local_agent", status: "pending", startedAt: 2000 });
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(2);
    // These descriptors belong only to activity; the delegation retains its
    // existing transcript representation without a duplicate workflow row.
    expect(JSON.stringify(result.rows)).not.toContain('"workKind":"workflow"');
  });

  it.each(["completed", "failed", "interrupted"] as const)("removes an agent on its own %s event", status => {
    const events = [entry("item/started", 1, { item: agent("a") }),
      entry("item/delegation/completed", 2, { scope: threadScope(), item: agent("a", status) })];
    expect(timeline(events).activeBackgroundCommands).toEqual([]);
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(0);
  });

  it("folds progress, ordinary completions and resumed work by item id", () => {
    const events = [entry("item/started", 1, { item: agent("a") }),
      entry("item/completed", 2, { item: agent("a", "completed") }),
      entry("item/delegation/progress", 3, { scope: threadScope(), item: agent("a", "pending", { label: "Continue review" }) })];
    expect(timeline(events).activeBackgroundCommands).toMatchObject([{ itemId: "a", description: "Continue review", startedAt: 1000 }]);
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(1);
  });

  it("uses the child reference when a label is empty and accepts a standalone progress snapshot", () => {
    expect(timeline([entry("item/delegation/progress", 1, { scope: threadScope(), item: agent("a", "pending", { label: "" }) })])
      .activeBackgroundCommands).toMatchObject([{ description: "child-a" }]);
  });

  it.each([
    { status: "pending", skipTranscript: false, expected: ["native"] },
    { status: "completed", skipTranscript: false, expected: ["a"] },
    { status: "pending", skipTranscript: true, expected: ["a"] },
  ])("avoids duplicating an agent already represented by a visible running native task: %j", ({ status, skipTranscript, expected }) => {
    const events = [entry("item/started", 1, { item: agent("a") }),
      entry("item/started", 2, { item: task("native", "a", { status, skipTranscript }) })];
    expect(timeline(events).activeBackgroundCommands.map(row => row.itemId)).toEqual(expected);
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(1);
  });

  it("represents nested agents by their running parent, then shows a child that outlives it", () => {
    const events = [entry("item/started", 1, { item: agent("parent") }),
      entry("item/started", 2, { item: agent("nested", "pending", { parentToolCallId: "parent" }) })];
    expect(timeline(events).activeBackgroundCommands.map(row => row.itemId)).toEqual(["parent"]);
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(1);
    events.push(entry("item/completed", 3, { item: agent("parent", "completed") }));
    expect(timeline(events).activeBackgroundCommands.map(row => row.itemId)).toEqual(["nested"]);
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(1);
  });

  it("does not mistake a background command for the agent that spawned it", () => {
    const events = [entry("item/started", 1, { item: agent("a") }),
      entry("item/started", 2, { item: task("command", "a", { taskType: "local_bash" }) })];
    expect(threadActivityFromEvents(events)).toMatchObject({ activeBackgroundAgentCount: 1, activeBackgroundCommandCount: 1 });
    expect(timeline(events).activeBackgroundCommands.map(row => row.itemId).sort()).toEqual(["a", "command"]);
  });

  it("counts a nested native agent only once through its running parent", () => {
    const events = [entry("item/started", 1, { item: agent("parent") }),
      entry("item/started", 2, { item: agent("nested", "pending", { parentToolCallId: "parent" }) }),
      entry("item/started", 3, { item: task("native", "nested") })];
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(1);
    expect(timeline(events).activeBackgroundCommands.map(row => row.itemId)).toEqual(["parent"]);
    events.push(entry("item/completed", 4, { item: agent("parent", "completed") }));
    expect(threadActivityFromEvents(events).activeBackgroundAgentCount).toBe(1);
    expect(timeline(events).activeBackgroundCommands.map(row => row.itemId)).toEqual(["native"]);
  });

  it("invalidates activity for delegation starts, progress and terminal events", () => {
    for (const type of ["item/started", "item/completed", "item/delegation/progress", "item/delegation/completed"]) {
      expect(isBackgroundTaskLifecyclePayload(type, { item: agent("a") })).toBe(true);
    }
    expect(isBackgroundTaskLifecyclePayload("turn/completed", {})).toBe(false);
  });
});
