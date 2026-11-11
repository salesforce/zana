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

  it("resolves the npm global package image when PATH only has claude.cmd", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-npm-"));
    try {
      const prefix = join(root, "npm");
      const exe = join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      mkdirSync(join(exe, ".."), { recursive: true });
      writeExecutable(join(prefix, "claude"));
      writeExecutable(join(prefix, "claude.cmd"));
      writeExecutable(exe);
      expect(
        resolveClaudeCodeExecutable({ env: { PATH: prefix }, platform: "win32" }),
      ).toBe(exe);
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  it("prefers an earlier npm global install over a later claude.exe", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-npm-order-"));
    try {
      const prefix = join(root, "npm");
      const later = join(root, "later");
      const exe = join(prefix, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      mkdirSync(join(exe, ".."), { recursive: true });
      mkdirSync(later);
      writeExecutable(exe);
      writeExecutable(join(later, "claude.exe"));
      expect(
        resolveClaudeCodeExecutable({
          env: { PATH: [prefix, later].join(delimiter) },
          platform: "win32",
        }),
      ).toBe(exe);
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  it("reads the claude.exe path out of an npm claude.cmd shim", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-cmd-"));
    try {
      const prefix = join(root, "npm");
      const exe = join(prefix, "vendor", "claude.exe");
      mkdirSync(join(prefix, "vendor"), { recursive: true });
      writeFileSync(
        join(prefix, "claude.cmd"),
        '@ECHO off\r\n"%dp0%\\vendor\\claude.exe" %*\r\n',
      );
      writeExecutable(exe);
      expect(
        resolveClaudeCodeExecutable({ env: { PATH: prefix }, platform: "win32" }),
      ).toBe(exe);
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  it("ignores a claude.cmd shim that escapes its directory", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-cmd-escape-"));
    try {
      const prefix = join(root, "npm");
      mkdirSync(prefix, { recursive: true });
      writeExecutable(join(root, "claude.exe"));
      writeFileSync(
        join(prefix, "claude.cmd"),
        '@ECHO off\r\n"%dp0%\\..\\claude.exe" %*\r\n',
      );
      expect(
        resolveClaudeCodeExecutable({ env: { PATH: prefix }, platform: "win32" }),
      ).toBeNull();
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  it("finds a global npm install under APPDATA when it is not on PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-appdata-"));
    try {
      const exe = join(root, "npm", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      mkdirSync(join(exe, ".."), { recursive: true });
      writeExecutable(exe);
      expect(
        resolveClaudeCodeExecutable({
          env: { APPDATA: root, PATH: "" },
          platform: "win32",
        }),
      ).toBe(exe);
    } finally { rmSync(root, { force: true, recursive: true }); }
  });

  it("finds a global npm install under ProgramFiles nodejs", () => {
    const root = mkdtempSync(join(tmpdir(), "zcc-claude-win-programfiles-"));
    try {
      const exe = join(root, "nodejs", "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
      mkdirSync(join(exe, ".."), { recursive: true });
      writeExecutable(exe);
      expect(
        resolveClaudeCodeExecutable({
          env: { ProgramFiles: root, PATH: "" },
          platform: "win32",
        }),
      ).toBe(exe);
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
