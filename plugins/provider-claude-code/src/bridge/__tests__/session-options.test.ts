import { describe, expect, it } from "vitest";
import {
  CLAUDE_PLAN_CHECKLIST_TOOLS,
  CLAUDE_TODO_TOOLS_ENV_VAR,
  mergeClaudePlanChecklistAllowedTools,
  withClaudeTodoToolsEnv,
} from "../session-options.js";

describe("withClaudeTodoToolsEnv", () => {
  it("enables checklist tools by default so newer Claude models emit planSteps", () => {
    expect(withClaudeTodoToolsEnv({ HOME: "/tmp" })).toMatchObject({
      HOME: "/tmp",
      [CLAUDE_TODO_TOOLS_ENV_VAR]: "1",
    });
  });

  it("honors an explicit session override", () => {
    expect(
      withClaudeTodoToolsEnv({ [CLAUDE_TODO_TOOLS_ENV_VAR]: "1" }, "0")[
        CLAUDE_TODO_TOOLS_ENV_VAR
      ],
    ).toBe("0");
  });
});

describe("mergeClaudePlanChecklistAllowedTools", () => {
  it("adds TaskCreate and TodoWrite without dropping existing MCP tools", () => {
    expect(
      mergeClaudePlanChecklistAllowedTools(["mcp__bridge__ping"]),
    ).toEqual(["mcp__bridge__ping", ...CLAUDE_PLAN_CHECKLIST_TOOLS]);
  });

  it("is idempotent when the checklist tools are already present", () => {
    const once = mergeClaudePlanChecklistAllowedTools(undefined);
    expect(mergeClaudePlanChecklistAllowedTools(once)).toEqual(once);
  });
});
