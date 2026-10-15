import {
  LOCAL_AGENT_TASK_TYPE,
  isBackgroundAgentTaskType,
  type ThreadEventDelegationItem,
} from "@zana-ai/zcc-domain/thread-runtime";
import type { EventProjectionWorkflowMessage } from "./event-projection-message.js";
import type { ThreadEventWithMeta } from "./group-event-projection-turns.js";

/**
 * Open delegations use the existing background-agent card without adding a
 * second transcript row. Their own lifecycle is authoritative: a parent turn
 * ending does not mean its child has stopped, regardless of `background`.
 */
export function projectOpenDelegationActivity(
  events: readonly ThreadEventWithMeta[],
  tasks: readonly EventProjectionWorkflowMessage[],
): {
  agents: EventProjectionWorkflowMessage[];
  representedTaskIds: ReadonlySet<string>;
  directTaskIds: ReadonlySet<string>;
} {
  const delegations = new Map<string, {
    first: ThreadEventWithMeta;
    item: ThreadEventDelegationItem;
  }>();
  for (const entry of events) {
    const { event } = entry;
    if (
      (event.type === "item/started" || event.type === "item/completed" ||
        event.type === "item/delegation/progress" || event.type === "item/delegation/completed") &&
      event.item.type === "delegation"
    ) {
      delegations.set(event.item.id, {
        first: delegations.get(event.item.id)?.first ?? entry,
        item: event.item,
      });
    }
  }
  const represented = new Set(tasks.filter(task =>
    task.status === "pending" && !task.skipTranscript && isBackgroundAgentTaskType(task.taskType),
  ).map(task => task.parentToolCallId));
  const representedTaskIds = new Set(tasks.flatMap(task => {
    if (!isBackgroundAgentTaskType(task.taskType)) return [];
    const spawning = delegations.get(task.parentToolCallId ?? "");
    const parentId = spawning?.item.parentToolCallId;
    return parentId && delegations.get(parentId)?.item.status === "pending" ? [task.itemId] : [];
  }));
  const directTaskIds = new Set(tasks.filter(task => isBackgroundAgentTaskType(task.taskType) &&
    delegations.has(task.parentToolCallId ?? "") && !representedTaskIds.has(task.itemId)).map(task => task.itemId));
  const agents: EventProjectionWorkflowMessage[] = [...delegations.values()].flatMap(({ first: { event, meta }, item }) => {
    if (item.status !== "pending" || represented.has(item.id) ||
      (item.parentToolCallId && delegations.get(item.parentToolCallId)?.item.status === "pending")) return [];
    return [{
      kind: "workflow" as const,
      id: item.id,
      itemId: item.id,
      threadId: event.threadId,
      scope: event.scope,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      // Link to the delegation itself so the existing selector can detect
      // nested agents and inherit any model recorded on the spawning call.
      parentToolCallId: item.id,
      taskType: LOCAL_AGENT_TASK_TYPE,
      description: item.label || item.childRef,
      workflowName: null,
      model: null,
      status: "pending" as const,
      taskStatus: "running" as const,
      skipTranscript: false,
      workflow: null,
      usage: null,
      summary: item.summary ?? null,
      error: null,
      completedAt: null,
    }];
  });
  return { agents, representedTaskIds, directTaskIds };
}
