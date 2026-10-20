import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os, { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NODE_SESSION_NAME_FS,
  latestSessionName,
  readResumeSessionName,
  type SessionNameFs,
} from "../session-name.js";

const agentName = (name: string) =>
  JSON.stringify({ type: "agent-name", agentName: name, sessionId: "s" });
const customTitle = (title: string) =>
  JSON.stringify({ type: "custom-title", customTitle: title, sessionId: "s" });

function memoryFs(files: Record<string, string>, dirs: Record<string, string[]> = {}): SessionNameFs {
  return {
    isFile: (file) => file in files,
    readdir: (dir) => dirs[dir] ?? [],
    readTail: (file) => files[file]!,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("latestSessionName", () => {
  it("returns the newest agent-name or custom-title value", () => {
    const text = [
      '"agent-name" cut-off line from the tail start',
      customTitle("Old"),
      agentName("Old"),
      JSON.stringify({ type: "user", message: { content: "Reviewer: docs" } }),
      customTitle("Reviewer: docs"),
      agentName("  Reviewer: docs  "),
      agentName("   "),
      JSON.stringify({ type: "agent-name", agentName: 7 }),
      JSON.stringify({ type: "summary", "custom-title": "x" }),
    ].join("\n");
    expect(latestSessionName(text)).toBe("Reviewer: docs");
  });

  it("prefers a fork's own title over the copied source name", () => {
    const text = [customTitle("Reviewer"), agentName("Reviewer"), customTitle("Reviewer (fork)")].join("\n");
    expect(latestSessionName(text)).toBe("Reviewer (fork)");
  });

  it("returns undefined for a session that was never renamed", () => {
    expect(latestSessionName(JSON.stringify({ type: "user" }))).toBeUndefined();
  });
});

describe("readResumeSessionName", () => {
  const projects = path.join("/cfg", "projects");

  it("reads the transcript in the cwd's project folder", () => {
    const file = path.join(projects, "C--work-my-app", "s.jsonl");
    const fs = memoryFs({ [file]: agentName("Planner: release") });
    expect(readResumeSessionName({ sessionId: "s", cwd: "C:\\work\\my.app", env: { CLAUDE_CONFIG_DIR: "/cfg" }, fs }))
      .toBe("Planner: release");
  });

  it("falls back to scanning project folders and to ~/.claude", () => {
    vi.spyOn(os, "homedir").mockReturnValue("/home/me");
    const home = path.join("/home/me", ".claude", "projects");
    const file = path.join(home, "-very-long-path-hash", "s.jsonl");
    const fs = memoryFs({ [file]: agentName("Tester: smoke") }, { [home]: ["other", "-very-long-path-hash"] });
    expect(readResumeSessionName({ sessionId: "s", cwd: "/very/long/path", env: {}, fs })).toBe("Tester: smoke");
    expect(readResumeSessionName({ sessionId: "missing", cwd: "/very/long/path", env: {}, fs })).toBeUndefined();
  });

  it("treats an unreadable transcript as unnamed", () => {
    const file = path.join(projects, "-p", "s.jsonl");
    const fs: SessionNameFs = {
      ...memoryFs({ [file]: "" }),
      readTail: () => { throw new Error("EBUSY"); },
    };
    expect(readResumeSessionName({ sessionId: "s", cwd: "/p", env: { CLAUDE_CONFIG_DIR: "/cfg" }, fs })).toBeUndefined();
  });
});

describe("NODE_SESSION_NAME_FS", () => {
  it("reads only the bounded tail and treats missing paths as absent", () => {
    const root = mkdtempSync(path.join(tmpdir(), "session-name-"));
    try {
      const file = path.join(root, "s.jsonl");
      writeFileSync(file, "head\ntail");
      mkdirSync(path.join(root, "dir"));
      expect(NODE_SESSION_NAME_FS.isFile(file)).toBe(true);
      expect(NODE_SESSION_NAME_FS.isFile(path.join(root, "dir"))).toBe(false);
      expect(NODE_SESSION_NAME_FS.isFile(path.join(root, "missing"))).toBe(false);
      expect(NODE_SESSION_NAME_FS.readdir(root).sort()).toEqual(["dir", "s.jsonl"]);
      expect(NODE_SESSION_NAME_FS.readdir(path.join(root, "missing"))).toEqual([]);
      expect(NODE_SESSION_NAME_FS.readTail(file, 4)).toBe("tail");
      expect(NODE_SESSION_NAME_FS.readTail(file, 100)).toBe("head\ntail");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
