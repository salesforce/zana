import { threadScope, turnScope } from "@zana-ai/zcc-domain/thread-runtime";
import type {
  ThreadEvent,
  ThreadEventBackgroundTaskItem,
} from "@zana-ai/zcc-domain/thread-runtime";
import { describe, expect, it } from "vitest";
import {
  EMPTY_THREAD_ACTIVITY,
  isBackgroundTaskLifecyclePayload,
  threadActivityFromEvents,
} from "../src/thread-activity-from-events.js";
import type { ThreadEventWithMeta } from "../src/index.js";

function withMeta(event: ThreadEvent, seq: number): ThreadEventWithMeta {
  return {
    event,
    meta: {
      id: `event-${seq}`,
      seq,
      createdAt: seq * 1_000,
    },
  };
}

function bashItem(args: {
  taskStatus: ThreadEventBackgroundTaskItem["taskStatus"];
  status: ThreadEventBackgroundTaskItem["status"];
  id?: string;
  description?: string;
  skipTranscript?: boolean;
}): ThreadEventBackgroundTaskItem {
  return {
    type: "backgroundTask",
    id: args.id ?? "task:bash-1",
    taskType: "local_bash",
    description: args.description ?? "npm run dev",
    status: args.status,
    taskStatus: args.taskStatus,
    skipTranscript: args.skipTranscript ?? false,
  };
}

function workflowItem(args: {
  taskStatus: ThreadEventBackgroundTaskItem["taskStatus"];
  status: ThreadEventBackgroundTaskItem["status"];
  id?: string;
}): ThreadEventBackgroundTaskItem {
  return {
    type: "backgroundTask",
    id: args.id ?? "task:wf-1",
    taskType: "local_workflow",
    description: "fixture workflow",
    status: args.status,
    taskStatus: args.taskStatus,
    skipTranscript: false,
    workflowName: "fixture",
  };
}

function agentItem(args: {
  taskStatus: ThreadEventBackgroundTaskItem["taskStatus"];
  status: ThreadEventBackgroundTaskItem["status"];
  id?: string;
}): ThreadEventBackgroundTaskItem {
  return {
    type: "backgroundTask",
    id: args.id ?? "task:agent-1",
    taskType: "local_agent",
    description: "Map coverage",
    status: args.status,
    taskStatus: args.taskStatus,
    skipTranscript: false,
  };
}

function started(
  item: ThreadEventBackgroundTaskItem,
  seq: number,
): ThreadEventWithMeta {
  return withMeta(
    {
      type: "item/started",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: turnScope("turn-1"),
      item,
    },
    seq,
  );
}

function progress(
  item: ThreadEventBackgroundTaskItem,
  seq: number,
): ThreadEventWithMeta {
  return withMeta(
    {
      type: "item/backgroundTask/progress",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: threadScope(),
      item,
    },
    seq,
  );
}

function completed(
  item: ThreadEventBackgroundTaskItem,
  seq: number,
): ThreadEventWithMeta {
  return withMeta(
    {
      type: "item/backgroundTask/completed",
      threadId: "thread-1",
      providerThreadId: "provider-1",
      scope: threadScope(),
      item,
    },
    seq,
  );
}

describe("threadActivityFromEvents", () => {
  it("returns zeros with no events", () => {
    expect(threadActivityFromEvents([])).toEqual(EMPTY_THREAD_ACTIVITY);
  });

  it("counts a running background bash command", () => {
    expect(
      threadActivityFromEvents([
        started(bashItem({ status: "pending", taskStatus: "running" }), 1),
        progress(bashItem({ status: "pending", taskStatus: "running" }), 2),
      ]),
    ).toEqual({
      ...EMPTY_THREAD_ACTIVITY,
      activeBackgroundCommandCount: 1,
    });
  });

  it("drops a command once it settles", () => {
    expect(
      threadActivityFromEvents([
        started(bashItem({ status: "pending", taskStatus: "running" }), 1),
        completed(bashItem({ status: "completed", taskStatus: "completed" }), 2),
      ]),
    ).toEqual(EMPTY_THREAD_ACTIVITY);
  });

  it("counts concurrent commands, workflows, and background agents separately", () => {
    expect(
      threadActivityFromEvents([
        started(bashItem({ status: "pending", taskStatus: "running" }), 1),
        started(
          bashItem({
            status: "pending",
            taskStatus: "running",
            id: "task:bash-2",
          }),
          2,
        ),
        started(workflowItem({ status: "pending", taskStatus: "running" }), 3),
        started(agentItem({ status: "pending", taskStatus: "running" }), 4),
      ]),
    ).toEqual({
      ...EMPTY_THREAD_ACTIVITY,
      activeBackgroundCommandCount: 2,
      activeWorkflowCount: 1,
      activeBackgroundAgentCount: 1,
    });
  });

  it("skips skipTranscript housekeeping tasks", () => {
    expect(
      threadActivityFromEvents([
        started(
          bashItem({
            status: "pending",
            taskStatus: "running",
            skipTranscript: true,
          }),
          1,
        ),
      ]),
    ).toEqual(EMPTY_THREAD_ACTIVITY);
  });

  it("counts an active goal", () => {
    expect(
      threadActivityFromEvents([
        withMeta(
          {
            type: "thread/goal/updated",
            threadId: "thread-1",
            providerThreadId: "provider-1",
            scope: threadScope(),
            objective: "Ship the server",
            status: "active",
            tokenBudget: 10_000,
            tokensUsed: 0,
            timeUsedSeconds: 0,
          },
          1,
        ),
      ]),
    ).toEqual({
      ...EMPTY_THREAD_ACTIVITY,
      activeGoalCount: 1,
    });
  });
});

describe("isBackgroundTaskLifecyclePayload", () => {
  it("recognizes progress, completed, and item started/completed with a nested task", () => {
    expect(
      isBackgroundTaskLifecyclePayload("item/backgroundTask/progress"),
    ).toBe(true);
    expect(
      isBackgroundTaskLifecyclePayload("item/backgroundTask/completed"),
    ).toBe(true);
    expect(
      isBackgroundTaskLifecyclePayload("item/started", {
        item: { type: "backgroundTask" },
      }),
    ).toBe(true);
    expect(
      isBackgroundTaskLifecyclePayload("item/completed", {
        item: { type: "backgroundTask" },
      }),
    ).toBe(true);
    expect(
      isBackgroundTaskLifecyclePayload("item/started", {
        item: { type: "toolCall" },
      }),
    ).toBe(false);
    expect(isBackgroundTaskLifecyclePayload("turn/completed")).toBe(false);
  });
});
