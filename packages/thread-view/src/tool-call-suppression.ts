import { claudeTaskToolNameValues } from "@zana-ai/zcc-domain/thread-runtime";
import type { ThreadEvent } from "@zana-ai/zcc-domain/thread-runtime";

const SUPPRESSED_TIMELINE_TOOL_NAMES = new Set([
  ...claudeTaskToolNameValues,
  "TodoRead",
  "TodoWrite",
  "ToolSearch",
  // AskUserQuestion is fully represented by its dedicated user-question
  // lifecycle row. Keeping the generic tool-call row too produces a confusing
  // duplicate ("Running tool: AskUserQuestion …" plus "Waiting for approval"
  // alongside the question's own "Waiting for answer" row).
  "AskUserQuestion",
]);

export function shouldSuppressLowValueToolCall(decoded: ThreadEvent): boolean {
  if (
    (decoded.type !== "item/started" && decoded.type !== "item/completed") ||
    decoded.item.type !== "toolCall"
  ) {
    return false;
  }

  if (!SUPPRESSED_TIMELINE_TOOL_NAMES.has(decoded.item.tool)) {
    return false;
  }

  return (
    decoded.item.status === "pending" || decoded.item.status === "completed"
  );
}
