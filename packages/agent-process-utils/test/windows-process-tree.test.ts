import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installWindowsProcessTreeKill,
  killProcessGroup,
  spawnPortablePipedProcess,
  stopProcessGroupLeaderFirst,
  type PortablePipedChildProcess,
  type ProcessTreeKillHost,
  windowsTaskkillPath,
} from "../src/index.js";

// An agent CLI installed by npm on Windows is a `.cmd` shim. cross-spawn runs
// it as cmd.exe -> node.exe (the shim target) -> the real CLI. `child.kill()`
// ends only cmd.exe, which is how codex and opencode trees outlived Zana.
const windowsOnly = process.platform === "win32" ? describe : describe.skip;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// taskkill alone takes about 1.5 s, beyond the default budget on a busy machine.
windowsOnly("Windows process tree stop", { timeout: 30_000 }, () => {
  const dirs: string[] = [];
  const pids: number[] = [];

  afterEach(() => {
    for (const pid of pids.splice(0)) {
      try { process.kill(pid); } catch { /* Already gone. */ }
    }
    // taskkill takes about 1.5 s, so the shim can still hold its directory.
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 100 });
  });

  /** cmd.exe -> node fake-cli.js -> node grandchild; reports both node PIDs. */
  async function spawnShimmedCli(): Promise<{
    child: PortablePipedChildProcess;
    cliPid: number;
    grandchildPid: number;
  }> {
    const dir = mkdtempSync(join(tmpdir(), "zcc tree "));
    dirs.push(dir);
    writeFileSync(join(dir, "fake-cli.js"), [
      "const { spawn } = require('node:child_process');",
      "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });",
      "process.stdout.write(JSON.stringify({ cli: process.pid, grandchild: g.pid }) + '\\n');",
      "setInterval(() => {}, 1000);",
    ].join("\n"));
    writeFileSync(
      join(dir, "fake-agent.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0fake-cli.js" %*\r\n`,
    );
    const child = spawnPortablePipedProcess({
      command: "fake-agent",
      args: ["app-server"],
      env: { ...process.env, PATH: `${dir};${process.env.PATH}` },
    });
    const line = await new Promise<string>((resolve, reject) => {
      let buffered = "";
      child.stdout.setEncoding("utf8").on("data", (text: string) => {
        buffered += text;
        const end = buffered.indexOf("\n");
        if (end >= 0) resolve(buffered.slice(0, end));
      });
      child.once("error", reject);
      child.once("exit", () => reject(new Error("fake CLI exited before reporting")));
    });
    const reported = JSON.parse(line) as { cli: number; grandchild: number };
    pids.push(reported.cli, reported.grandchild);
    expect(child.pid).not.toBe(reported.cli);
    expect(isAlive(reported.cli)).toBe(true);
    expect(isAlive(reported.grandchild)).toBe(true);
    return { child, cliPid: reported.cli, grandchildPid: reported.grandchild };
  }

  it("stops the CLI and its grandchild behind a .cmd shim", async () => {
    const { child, cliPid, grandchildPid } = await spawnShimmedCli();
    expect(child.kill("SIGTERM")).toBe(true);
    expect(child.killed).toBe(true);
    await waitFor(() => !isAlive(cliPid) && !isAlive(grandchildPid));
    await waitFor(() => child.exitCode !== null || child.signalCode !== null);
  });

  it("stops the whole tree through killProcessGroup", async () => {
    const { child, cliPid, grandchildPid } = await spawnShimmedCli();
    killProcessGroup({ child, signal: "SIGKILL" });
    await waitFor(() => !isAlive(cliPid) && !isAlive(grandchildPid));
  });

  it("stops the whole tree through stopProcessGroupLeaderFirst", async () => {
    const { child, cliPid, grandchildPid } = await spawnShimmedCli();
    await stopProcessGroupLeaderFirst({ child, timeoutMs: 5000, killGraceMs: 1000 });
    await waitFor(() => !isAlive(cliPid) && !isAlive(grandchildPid));
  });

  it("keeps the plain kill once the root has exited", async () => {
    const { child, cliPid, grandchildPid } = await spawnShimmedCli();
    child.kill("SIGKILL");
    await waitFor(() => !isAlive(cliPid) && !isAlive(grandchildPid));
    await waitFor(() => child.exitCode !== null || child.signalCode !== null);
    expect(() => child.kill("SIGTERM")).not.toThrow();
  });
});

// The decisions taskkill drives, on every OS: a fake Windows host and a real,
// live child whose `kill` is observed.
describe("installWindowsProcessTreeKill", () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  function liveChild() {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    children.push(child);
    const realKill = child.kill.bind(child);
    const rootKill = vi.fn((signal?: NodeJS.Signals | number) => realKill(signal));
    child.kill = rootKill as unknown as ChildProcess["kill"];
    return { child, realKill, rootKill };
  }

  function fakeTaskkill() {
    const taskkill = Object.assign(new EventEmitter(), { kill: vi.fn() });
    const calls: string[][] = [];
    const host: ProcessTreeKillHost = {
      platform: "win32",
      execPath: "C:\other\runtime.exe",
      spawnTaskkill: (args) => {
        calls.push([...args]);
        return taskkill as unknown as ChildProcess;
      },
    };
    return { taskkill, calls, host };
  }

  it("runs taskkill over the tree and leaves the root to it on success", () => {
    const { child, rootKill } = liveChild();
    const { taskkill, calls, host } = fakeTaskkill();
    installWindowsProcessTreeKill(child, host);
    expect(child.kill("SIGTERM")).toBe(true);
    expect(child.killed).toBe(true);
    expect(calls).toEqual([["/PID", String(child.pid), "/T", "/F"]]);
    taskkill.emit("exit", 0);
    expect(rootKill).not.toHaveBeenCalled();
  });

  it.each([128, 1])("kills the root when taskkill exits %i", (code) => {
    const { child, rootKill } = liveChild();
    const { taskkill, host } = fakeTaskkill();
    installWindowsProcessTreeKill(child, host);
    child.kill("SIGKILL");
    taskkill.emit("exit", code);
    expect(rootKill).toHaveBeenCalledWith("SIGKILL");
  });

  it("kills the root when taskkill cannot start", () => {
    const { child, rootKill } = liveChild();
    const { taskkill, host } = fakeTaskkill();
    installWindowsProcessTreeKill(child, host);
    child.kill("SIGTERM");
    taskkill.emit("error", new Error("ENOENT"));
    expect(rootKill).toHaveBeenCalledWith("SIGTERM");
  });

  it("kills the root when spawning taskkill throws", () => {
    const { child, rootKill } = liveChild();
    installWindowsProcessTreeKill(child, {
      platform: "win32",
      execPath: "C:\other\runtime.exe",
      spawnTaskkill: () => { throw new Error("EMFILE"); },
    });
    child.kill("SIGTERM");
    expect(rootKill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stops a taskkill that hangs", () => {
    vi.useFakeTimers();
    const { child } = liveChild();
    const { taskkill, host } = fakeTaskkill();
    installWindowsProcessTreeKill(child, host);
    child.kill("SIGTERM");
    vi.advanceTimersByTime(10_000);
    expect(taskkill.kill).toHaveBeenCalled();
  });

  it("never hands a reaped child's PID to taskkill", async () => {
    const { child, realKill, rootKill } = liveChild();
    const { calls, host } = fakeTaskkill();
    installWindowsProcessTreeKill(child, host);
    realKill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    rootKill.mockClear();
    child.kill("SIGTERM");
    expect(calls).toEqual([]);
    expect(rootKill).toHaveBeenCalledWith("SIGTERM");
  });

  it("leaves kill alone off Windows and for a root running this runtime", () => {
    const { child } = liveChild();
    const before = child.kill;
    const { calls, host } = fakeTaskkill();
    installWindowsProcessTreeKill(child, { ...host, platform: "linux" });
    installWindowsProcessTreeKill(child, { ...host, execPath: process.execPath });
    expect(child.kill).toBe(before);
    expect(calls).toEqual([]);
  });
});

describe("windowsTaskkillPath", () => {
  it("uses System32 under SystemRoot, then windir, so PATH is never searched", () => {
    expect(windowsTaskkillPath({ SystemRoot: "C:/Windows", windir: "D:/Other" }))
      .toBe(join("C:/Windows", "System32", "taskkill.exe"));
    expect(windowsTaskkillPath({ windir: "D:/Win" })).toBe(join("D:/Win", "System32", "taskkill.exe"));
  });

  it("falls back to the bare name with neither variable set", () => {
    expect(windowsTaskkillPath({})).toBe("taskkill.exe");
  });
});
