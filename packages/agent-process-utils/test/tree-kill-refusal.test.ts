import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  registerProtectedProcessPid,
  stopWindowsProcessTree,
  treeKillRefusal,
} from "../src/index.js";

describe("Windows tree kill refusal", () => {
  it.each([0, -1, 1.5, Number.NaN])("refuses invalid PID %s", (pid) => {
    expect(treeKillRefusal(pid)).toMatch(/not a valid/);
  });

  it("refuses this process and its parent", () => {
    expect(treeKillRefusal(process.pid)).toMatch(/this process/);
    expect(treeKillRefusal(process.ppid)).toMatch(/parent/);
  });

  it("refuses a registered Zana PID until released", () => {
    const release = registerProtectedProcessPid(987_654);
    expect(treeKillRefusal(987_654)).toMatch(/registered Zana/);
    release();
    expect(treeKillRefusal(987_654)).toBeUndefined();
  });

  it("never spawns taskkill for a protected PID and logs why", () => {
    const spawnTaskkill = vi.fn();
    const warn = vi.fn();
    const onDone = vi.fn();
    stopWindowsProcessTree(process.pid, onDone, { spawnTaskkill, log: warn });
    expect(spawnTaskkill).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(null);
    expect(warn.mock.calls[0]?.[0]).toContain(`PID ${process.pid}`);
  });

  it("honours an injected protected list and still kills other PIDs", () => {
    const spawnTaskkill = vi.fn(() => { throw new Error("stop"); });
    const onDone = vi.fn();
    stopWindowsProcessTree(4242, onDone, { spawnTaskkill, protectedPids: () => [4242] });
    expect(spawnTaskkill).not.toHaveBeenCalled();
    stopWindowsProcessTree(4243, onDone, { spawnTaskkill, protectedPids: () => [4242] });
    expect(spawnTaskkill).toHaveBeenCalledTimes(1);
  });
});

describe("Windows tree kill logging", () => {
  it("logs the target and the outcome for a run kill", () => {
    const lines: string[] = [];
    const taskkill = Object.assign(new EventEmitter(), { kill: () => true });
    stopWindowsProcessTree(4244, () => {}, {
      spawnTaskkill: () => taskkill as never,
      log: (m: string) => lines.push(m),
    });
    taskkill.emit("exit", 0);
    expect(lines[0]).toMatch(/taskkill \/T \/F PID 4244 \(self=\d+ parent=\d+\)/);
    expect(lines[1]).toMatch(/PID 4244 finished: exit 0/);
  });
});

describe("environment-propagated protection", () => {
  it("refuses a PID a parent exported into the environment, and audits synchronously", async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { exportProtectedPid, PROTECTED_PIDS_ENV, TREE_KILL_AUDIT_ENV } = await import("../src/index.js");
    const dir = mkdtempSync(join(tmpdir(), "tree-audit-"));
    const file = join(dir, "tree-kill.log");
    process.env[TREE_KILL_AUDIT_ENV] = file;
    exportProtectedPid(777_001);
    try {
      const spawnTaskkill = vi.fn();
      stopWindowsProcessTree(777_001, () => {}, { spawnTaskkill, log: () => {} });
      expect(spawnTaskkill).not.toHaveBeenCalled();
      expect(readFileSync(file, "utf8")).toMatch(/refusing taskkill \/T \/F for PID 777001.*environment/);
    } finally {
      delete process.env[PROTECTED_PIDS_ENV];
      delete process.env[TREE_KILL_AUDIT_ENV];
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
