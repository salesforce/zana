import { describe, expect, it } from "vitest";
import { constants } from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  CLAUDE_PLAN_CHECKLIST_TOOLS,
  CLAUDE_TODO_TOOLS_ENV_VAR,
  mergeClaudePlanChecklistAllowedTools,
  withClaudeTodoToolsEnv,
  resolveClaudeCodeExecutable,
} from "../session-options.js";

it("reads legacy Claude executable settings and prioritizes canonical overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "zcc-claude-override-"));
  try {
    const executable = join(root, "claude");
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR);
    expect(resolveClaudeCodeExecutable({ env: { BB_CLAUDE_CODE_EXECUTABLE: executable } })).toBe(executable);
    expect(() => resolveClaudeCodeExecutable({ env: { BB_CLAUDE_CODE_EXECUTABLE: executable, ZCC_CLAUDE_CODE_EXECUTABLE: join(root, "missing") } })).toThrow("ZCC_CLAUDE_CODE_EXECUTABLE");
  } finally { rmSync(root, { force: true, recursive: true }); }
});

describe("resolveClaudeCodeExecutable on PATH", () => {
  function writeExecutable(path: string): void {
    writeFileSync(path, "#!/bin/sh\nexit 0\n");
    chmodSync(path, constants.S_IRUSR | constants.S_IWUSR | constants.S_IXUSR);
  }

  it("skips an extensionless shim on Windows and resolves claude.exe", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-path-"));
    try {
      const shimDir = join(root, "shim");
      const nativeDir = join(root, "native");
      mkdirSync(shimDir);
      mkdirSync(nativeDir);
      writeExecutable(join(shimDir, "claude"));
      writeExecutable(join(shimDir, "claude.cmd"));
      writeExecutable(join(nativeDir, "claude.exe"));
      expect(
        resolveClaudeCodeExecutable({
          env: { PATH: [shimDir, nativeDir].join(delimiter) },
          platform: "win32",
        }),
      ).toBe(join(nativeDir, "claude.exe"));
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  it("falls back to USERPROFILE native install on Windows when HOME is unset", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-home-"));
    try {
      mkdirSync(join(root, ".local", "bin"), { recursive: true });
      writeExecutable(join(root, ".local", "bin", "claude"));
      writeExecutable(join(root, ".local", "bin", "claude.exe"));
      expect(
        resolveClaudeCodeExecutable({ env: { USERPROFILE: root, PATH: "" }, platform: "win32" }),
      ).toBe(join(root, ".local", "bin", "claude.exe"));
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  it("keeps resolving the bare claude name off Windows", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-posix-path-"));
    try {
      writeExecutable(join(root, "claude"));
      expect(
        resolveClaudeCodeExecutable({ env: { PATH: root }, platform: "linux" }),
      ).toBe(join(root, "claude"));
    } finally { rmSync(root, { force: true, recursive: true }); }
  });
});

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
