import { describe, expect, it } from "vitest";
import type { TimelineRow, TimelineWorkRow } from "@zana-ai/zcc-server-contract";
import {
  buildTimelineActivityIntentTitles,
  buildTimelineRowTitle,
} from "../src/index.js";
import {
  createTimelineEventFactory,
  renderTimelineFixture,
} from "./timeline-test-harness.js";

const WORKSPACE = "/Users/dev/zcc-workspace/project";
const ATTACHMENTS = "/Users/dev/.zcc/attachments/project-1";
const SPILL_DIR = "/Users/dev/.claude/projects/p/session/tool-results";
const SPILL_FILE = "mcp-zcc-design_doc_read-1791789216742.txt";

function workRows(rows: readonly TimelineRow[]): TimelineWorkRow[] {
  return rows.flatMap((row) =>
    row.kind === "turn" && row.children
      ? workRows(row.children)
      : row.kind === "work"
        ? [row]
        : [],
  );
}

function renderCommand(command: string, roots = true, cwd = WORKSPACE) {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  const rendered = renderTimelineFixture({
    events: [
      event.turnStarted({ turnId: "turn-1", createdAt: 0 }),
      event.commandCompleted({
        turnId: "turn-1",
        itemId: "cmd-1",
        command,
        cwd,
        exitCode: 0,
        aggregatedOutput: "",
        createdAt: 1_000,
      }),
      event.turnCompleted({ turnId: "turn-1", createdAt: 2_000 }),
    ],
    projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    ...(roots ? { workspaceRoot: WORKSPACE, previewRoots: [ATTACHMENTS] } : {}),
  });
  const row = workRows(rendered.rows).find(
    (candidate) => candidate.workKind === "command",
  );
  if (!row || row.workKind !== "command") throw new Error("no command row");
  return row;
}

function previewAction(command: string, roots = true, cwd = WORKSPACE) {
  return buildTimelineActivityIntentTitles(renderCommand(command, roots, cwd))[0]
    ?.title.action;
}

function renderFileRead(path: string) {
  const event = createTimelineEventFactory({ threadId: "thread-1" });
  // The harness has no fileRead factory; reuse a completed item row and swap
  // in a structured fileRead item.
  const completed = event.commandCompleted({
    turnId: "turn-1",
    itemId: "read-1",
    command: "",
    exitCode: 0,
    aggregatedOutput: "",
    createdAt: 1_000,
  });
  const read = {
    ...completed,
    data: {
      ...completed.data,
      item: { type: "fileRead", id: "read-1", path, status: "completed" },
    },
  } as unknown as typeof completed;
  const rendered = renderTimelineFixture({
    events: [
      event.turnStarted({ turnId: "turn-1", createdAt: 0 }),
      read,
      event.turnCompleted({ turnId: "turn-1", createdAt: 2_000 }),
    ],
    projectionOptions: { threadStatus: "idle", turnMessageDetail: "full" },
    workspaceRoot: WORKSPACE,
    previewRoots: [ATTACHMENTS],
  });
  const row = workRows(rendered.rows).find(
    (candidate) => candidate.workKind === "file-read",
  );
  if (!row || row.workKind !== "file-read") throw new Error("no read row");
  return row;
}

describe("read preview roots", () => {
  it("hides Preview for a shell read of a file outside the project", () => {
    const row = renderCommand(
      `cd ${SPILL_DIR}/; head -c 600 ${SPILL_FILE}; echo; rg -n '^<file path' ${SPILL_FILE}`,
    );

    expect(row.activityIntents[0]).toMatchObject({
      type: "read",
      path: `${SPILL_DIR}/${SPILL_FILE}`,
      previewable: false,
    });
    const [title] = buildTimelineActivityIntentTitles(row);
    expect(title?.title.plain).toBe(`Read ${SPILL_DIR}/${SPILL_FILE}`);
    expect(title?.title.action).toBeNull();
  });

  it("hides Preview for reads through an unresolved shell variable", () => {
    expect(previewAction("sed -n 1,20p $F")).toBeNull();
    expect(previewAction("cat ~/notes.md")).toBeNull();
    expect(previewAction("cat ../sibling/file.ts")).toBeNull();
  });

  it("keeps Preview for workspace-relative and in-root absolute reads", () => {
    expect(previewAction("cd src && cat app.ts")).toEqual({
      kind: "open-file-preview",
      path: "src/app.ts",
    });
    expect(previewAction(`cat ${WORKSPACE}/src/app.ts`)).toEqual({
      kind: "open-file-preview",
      path: `${WORKSPACE}/src/app.ts`,
    });
    expect(previewAction(`F=${ATTACHMENTS}/shot.png; head $F`)).toEqual({
      kind: "open-file-preview",
      path: `${ATTACHMENTS}/shot.png`,
    });
    expect(renderCommand("cat src/app.ts").activityIntents[0]).not.toHaveProperty(
      "previewable",
    );
  });

  it("resolves relative reads against the command cwd", () => {
    // Codex reported `cat src/byoo/AGENTS.md` with cwd in another checkout;
    // Preview used to open the workspace's (missing) copy of that path.
    const other = "/tmp/data-org-verify";
    expect(renderCommand("cat src/byoo/AGENTS.md", true, other).activityIntents[0]).toMatchObject({
      path: `${other}/src/byoo/AGENTS.md`,
      previewable: false,
    });
    expect(previewAction("cat src/byoo/AGENTS.md", true, other)).toBeNull();
    // A cwd inside the workspace keeps a workspace-relative, previewable path.
    expect(previewAction("cat ./app.ts", true, `${WORKSPACE}/src`)).toEqual({
      kind: "open-file-preview",
      path: "src/app.ts",
    });
    // Without a usable cwd or workspace root the path is left as written.
    expect(previewAction("cat src/app.ts", true, "")).toEqual({
      kind: "open-file-preview",
      path: "src/app.ts",
    });
    expect(previewAction("cat src/app.ts", false, other)).toEqual({
      kind: "open-file-preview",
      path: "src/app.ts",
    });
    expect(previewAction("cat $F", true, other)).toBeNull();
  });

  it("rejects absolute paths that only share a root prefix or escape it", () => {
    expect(previewAction(`cat ${WORKSPACE}-other/app.ts`)).toBeNull();
    expect(previewAction(`cat ${WORKSPACE}/../secret.txt`)).toBeNull();
  });

  it("hides Preview for absolute reads when no root is known", () => {
    expect(previewAction(`cat ${WORKSPACE}/src/app.ts`, false)).toBeNull();
    expect(previewAction("cat src/app.ts", false)).toEqual({
      kind: "open-file-preview",
      path: "src/app.ts",
    });
  });

  it("applies the same rule to structured file-read rows", () => {
    const outside = renderFileRead(`${SPILL_DIR}/${SPILL_FILE}`);
    expect(outside.previewable).toBe(false);
    expect(
      buildTimelineRowTitle(outside, {
        summaryStyle: "bundle",
        workStyle: "default",
      }).action,
    ).toBeNull();

    const attachment = renderFileRead(`${ATTACHMENTS}/shot.png`);
    expect(attachment).not.toHaveProperty("previewable");
    expect(
      buildTimelineRowTitle(attachment, {
        summaryStyle: "bundle",
        workStyle: "default",
      }).action,
    ).toEqual({ kind: "open-file-preview", path: `${ATTACHMENTS}/shot.png` });
  });
});
