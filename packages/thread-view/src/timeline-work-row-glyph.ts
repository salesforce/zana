import {
  isBackgroundAgentTaskType,
  isBackgroundCommandTaskType,
  parseNamespacedGlyph,
} from "@zana-ai/zcc-domain/thread-runtime";
import type {
  TimelineActivityIntent,
  TimelineRowPresentation,
} from "@zana-ai/zcc-server-contract";
import { assertNever } from "./assert-never.js";
import { primaryTimelineActivityIntent } from "./timeline-activity-intents.js";
import type { TimelineActivityIntentTitle } from "./timeline-row-title.js";
import type { TimelineViewWorkRow } from "./timeline-view.js";

export type TimelineWorkRowGlyph =
  | "CircleQuestion"
  | "EditFile"
  | "File"
  | "FileText"
  | "Folder"
  | "Globe"
  | "ListTodo"
  | "Lock"
  | "Puzzle"
  | "Search"
  | "Terminal"
  | "UserRoundPlus"
  | "Zap";

const SKILL_FILE_NAME = "SKILL.md";
const HOST_GLYPHS = new Set<TimelineWorkRowGlyph>([
  "CircleQuestion",
  "EditFile",
  "File",
  "FileText",
  "Folder",
  "Globe",
  "ListTodo",
  "Lock",
  "Puzzle",
  "Search",
  "Terminal",
  "UserRoundPlus",
  "Zap",
]);

export function isTimelineWorkRowGlyph(
  glyph: string,
): glyph is TimelineWorkRowGlyph {
  return HOST_GLYPHS.has(glyph as TimelineWorkRowGlyph);
}

function isSkillReadIntent(intent: TimelineActivityIntent): boolean {
  if (intent.type !== "read") {
    return false;
  }
  const target = (intent.path ?? intent.name).replaceAll("\\", "/");
  return target.split("/").pop() === SKILL_FILE_NAME;
}

function explorationIntentGlyph(
  intentType: "read" | "list_files" | "search",
): TimelineWorkRowGlyph {
  switch (intentType) {
    case "search":
      return "Search";
    case "read":
      return "FileText";
    case "list_files":
      return "Folder";
    default:
      return assertNever(intentType);
  }
}

export function activityIntentTitleGlyph(
  entry: TimelineActivityIntentTitle,
): TimelineWorkRowGlyph {
  if (isSkillReadIntent(entry.intent)) {
    return "Zap";
  }
  return explorationIntentGlyph(entry.intentType);
}

export function workRowPresentation(
  row: TimelineViewWorkRow,
): TimelineRowPresentation | undefined {
  if (row.workKind === "approval" || row.workKind === "question") {
    return undefined;
  }
  return row.presentation;
}

function fallbackGlyphForWorkRow(row: TimelineViewWorkRow): TimelineWorkRowGlyph {
  if (row.workKind === "command" || row.workKind === "tool") {
    const intent = primaryTimelineActivityIntent(row);
    if (intent !== null && intent.type !== "unknown") {
      return explorationIntentGlyph(intent.type);
    }
  }
  switch (row.workKind) {
    case "file-change":
      return "EditFile";
    case "command":
    case "tool":
      return "Terminal";
    case "web-search":
      return "Search";
    case "web-fetch":
      return "Globe";
    case "image-view":
      return "File";
    case "file-read":
      return "FileText";
    case "search":
      return row.mode === "list" ? "Folder" : "Search";
    case "plan-steps":
      return "ListTodo";
    case "extension":
      return "Puzzle";
    case "delegation":
      return "UserRoundPlus";
    case "workflow":
      if (isBackgroundCommandTaskType(row.taskType)) {
        return "Terminal";
      }
      if (isBackgroundAgentTaskType(row.taskType)) {
        return "UserRoundPlus";
      }
      return "ListTodo";
    case "approval":
      return "Lock";
    case "question":
      return "CircleQuestion";
    default:
      return assertNever(row);
  }
}

export function workRowGlyph(row: TimelineViewWorkRow): TimelineWorkRowGlyph {
  if (isSkillReadCommandRow(row)) {
    return "Zap";
  }
  const presented = workRowPresentation(row)?.icon.glyph;
  if (presented !== undefined && isTimelineWorkRowGlyph(presented)) {
    return presented;
  }
  return fallbackGlyphForWorkRow(row);
}

export function workRowPluginGlyph(row: TimelineViewWorkRow): string | undefined {
  if (isSkillReadCommandRow(row)) {
    return undefined;
  }
  const presented = workRowPresentation(row)?.icon.glyph;
  return presented !== undefined && parseNamespacedGlyph(presented) !== null
    ? presented
    : undefined;
}

function isSkillReadCommandRow(row: TimelineViewWorkRow): boolean {
  return (
    (row.workKind === "command" || row.workKind === "tool") &&
    row.activityIntents.some(isSkillReadIntent)
  );
}
