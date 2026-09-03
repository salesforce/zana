import type { ThreadActivityState } from "@zana-ai/zcc-domain/thread-runtime";
import {
  isBackgroundAgentTaskType,
  isBackgroundCommandTaskType,
  LOCAL_WORKFLOW_TASK_TYPE,
} from "@zana-ai/zcc-domain/thread-runtime";
import {
  upsertBackgroundTaskMessage,
  type BackgroundTaskProjectionState,
} from "./background-task-projection.js";
import { extractThreadTimelineGoal } from "./goal-snapshot-extraction.js";
import type { ThreadEventWithMeta } from "./group-event-projection-turns.js";

export const EMPTY_THREAD_ACTIVITY: ThreadActivityState = Object.freeze({
  activeWorkflowCount: 0,
  activeBackgroundAgentCount: 0,
  activeBackgroundCommandCount: 0,
  activePlanModeCount: 0,
  activeGoalCount: 0,
});

/**
 * True when a stored conversation event is a background-task lifecycle
 * (Bash `run_in_background`, workflow, or background agent). Payload may be
 * the full ThreadEvent (`item` nested) or the event itself.
 */
export function isBackgroundTaskLifecyclePayload(
  type: string,
  payload?: unknown,
): boolean {
  if (
    type === "item/backgroundTask/progress" ||
    type === "item/backgroundTask/completed"
  ) {
    return true;
  }
  if (type !== "item/started" && type !== "item/completed") return false;
  const record =
    payload && typeof payload === "object"
      ? (payload as { item?: { type?: unknown }; type?: unknown })
      : undefined;
  const itemType =
    record && record.item && typeof record.item === "object"
      ? record.item.type
      : record?.type;
  return itemType === "backgroundTask";
}

/**
 * Cheap activity rollup for thread list/show. Reuses the per-item background
 * task projector; does not build a full timeline.
 */
export function threadActivityFromEvents(
  events: readonly ThreadEventWithMeta[],
): ThreadActivityState {
  const state: BackgroundTaskProjectionState = {
    messages: [],
    backgroundTasksByItemId: new Map(),
  };
  for (const { event, meta } of events) {
    upsertBackgroundTaskMessage(state, meta, event);
  }

  let activeWorkflowCount = 0;
  let activeBackgroundAgentCount = 0;
  let activeBackgroundCommandCount = 0;
  for (const message of state.backgroundTasksByItemId.values()) {
    if (message.skipTranscript) continue;
    if (message.status !== "pending") continue;
    if (isBackgroundCommandTaskType(message.taskType)) {
      activeBackgroundCommandCount += 1;
    } else if (isBackgroundAgentTaskType(message.taskType)) {
      activeBackgroundAgentCount += 1;
    } else if (message.taskType === LOCAL_WORKFLOW_TASK_TYPE) {
      activeWorkflowCount += 1;
    }
  }

  return {
    activeWorkflowCount,
    activeBackgroundAgentCount,
    activeBackgroundCommandCount,
    activePlanModeCount: 0,
    activeGoalCount: extractThreadTimelineGoal(events) ? 1 : 0,
  };
}
