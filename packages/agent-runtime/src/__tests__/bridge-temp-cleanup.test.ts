import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAdapter } from "../provider-adapter.js";
import { RuntimeProviderProcessManager } from "../runtime-provider-process.js";
import { RuntimeThreadIdentityRegistry } from "../runtime-thread-identity.js";
import { createFakeAdapter } from "../test/runtime-test-harness.js";

// Acceptance tests for #552, REQ-7: after a bridge child exits, the agent
// runtime removes that child's `bb-provider-bridge-<pid>-*` temp dir under the
// temp dir link-safely, even though the child's own exit handler never ran
// (the child is a real process that is killed and never gets to clean up).
// Real processes and real directories; TMPDIR points at a private folder.

/**
 * A stand-in bridge: it makes its pid-named temp dir the way the real bridge
 * does, links a user folder into it, then idles until it is killed. It has no
 * exit handler, which is the crash / hard-kill case.
 */
const bridgeScript = `
const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "bb-provider-bridge-" + process.pid + "-fixture-"));
mkdirSync(join(dir, "skills"), { recursive: true });
symlinkSync(process.env.TEST_USER_FOLDER, join(dir, "skills", "linked"), "junction");
writeFileSync(process.env.TEST_READY_FILE, dir);
setInterval(() => {}, 1000);
`;

describe("bridge temp dir cleanup after the child exits (#552)", () => {
  let base: string;
  let tempRoot: string;
  let userFolder: string;
  let readyFile: string;
  let scriptPath: string;
  const managers: RuntimeProviderProcessManager[] = [];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-bridge-cleanup-"));
    tempRoot = join(base, "tmp");
    mkdirSync(tempRoot);
    userFolder = join(base, "user-skills");
    mkdirSync(join(userFolder, "my-skill"), { recursive: true });
    writeFileSync(join(userFolder, "my-skill", "SKILL.md"), "keep me\n");
    readyFile = join(base, "ready.txt");
    scriptPath = join(base, "bridge.cjs");
    writeFileSync(scriptPath, bridgeScript);
    vi.stubEnv("TMPDIR", tempRoot);
    vi.stubEnv("TEMP", tempRoot);
    vi.stubEnv("TMP", tempRoot);
  });

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.shutdown()));
    vi.unstubAllEnvs();
    rmSync(base, { recursive: true, force: true });
  });

  function createManager(): RuntimeProviderProcessManager {
    const identityRegistry = new RuntimeThreadIdentityRegistry();
    let nextRequestId = 1;
    const manager = new RuntimeProviderProcessManager({
      additionalWorkspaceWriteRoots: [],
      adapterFactory: () => bridgeAdapter(),
      bridgeBundleDir: undefined,
      captureThreadExitState: (threadId) => ({
        activeTurnId: null,
        pendingTurnStart: false,
        providerThreadId: identityRegistry.getProviderThreadId(threadId) ?? null,
        threadId,
      }),
      createProviderIdentityState: (providerId) =>
        identityRegistry.createProviderState({ providerId }),
      env: {
        TEST_USER_FOLDER: userFolder,
        TEST_READY_FILE: readyFile,
        TMPDIR: tempRoot,
        TEMP: tempRoot,
        TMP: tempRoot,
      },
      getNextRequestId: () => nextRequestId++,
      handleStdoutLine: () => undefined,
      onProcessExit: vi.fn(),
      onProviderIdentityWaitersInterrupted: (providerProcess) =>
        identityRegistry.resolvePendingIdentityWaiters(providerProcess.identity),
      onProviderThreadDetached: (threadId) => identityRegistry.clearThread(threadId),
      skillRoots: [],
      workspacePath: base,
    });
    managers.push(manager);
    return manager;
  }

  function bridgeAdapter(): ProviderAdapter {
    const adapter = createFakeAdapter(scriptPath);
    return {
      ...adapter,
      process: { ...adapter.process, command: process.execPath, args: [scriptPath] },
      buildCommandPlan(command) {
        if (command.type === "initialize") {
          return { kind: "noop", reason: "initialized by process spawn" };
        }
        return adapter.buildCommandPlan(command);
      },
    };
  }

  async function waitFor(check: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function startBridge(manager: RuntimeProviderProcessManager) {
    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    await waitFor(() => existsSync(readyFile), "the bridge to create its temp dir");
    const bridgeDir = readFileSync(readyFile, "utf8");
    const providerProcess = manager.requireProviderProcess({
      processKey: "fake",
      providerId: "fake",
    });
    return { bridgeDir, providerProcess };
  }

  it("REQ-7 removes the exited child's temp dir and keeps the linked user folder", async () => {
    const manager = createManager();
    const { bridgeDir, providerProcess } = await startBridge(manager);
    expect(bridgeDir).toContain(`bb-provider-bridge-${providerProcess.child.pid}-`);
    expect(existsSync(bridgeDir)).toBe(true);

    // The child has no exit handler, so only the parent can clean up.
    await manager.shutdownProvider({ processKey: "fake", providerId: "fake" });
    await providerProcess.exitFinalized;
    await waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");

    expect(existsSync(bridgeDir)).toBe(false);
    expect(readFileSync(join(userFolder, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
  });

  it("REQ-7 removes the temp dir when the child crashes on its own", async () => {
    const manager = createManager();
    const { bridgeDir, providerProcess } = await startBridge(manager);

    providerProcess.child.kill("SIGKILL");
    await providerProcess.exitFinalized;
    await waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");

    expect(existsSync(bridgeDir)).toBe(false);
    expect(existsSync(join(userFolder, "my-skill", "SKILL.md"))).toBe(true);
  });

  it("REQ-7 does not touch another process's bridge dir or similarly named entries", async () => {
    const manager = createManager();
    const { bridgeDir, providerProcess } = await startBridge(manager);
    const childPid = providerProcess.child.pid as number;
    const other = join(tempRoot, `bb-provider-bridge-${childPid + 1}-fixture-zzz`);
    const prefixOfPid = join(tempRoot, `bb-provider-bridge-${childPid}0-fixture-zzz`);
    const oldFormat = join(tempRoot, "bb-provider-bridge-fixture-zzz");
    for (const dir of [other, prefixOfPid, oldFormat]) {
      mkdirSync(dir);
      writeFileSync(join(dir, "keep.txt"), "x");
    }

    providerProcess.child.kill("SIGKILL");
    await providerProcess.exitFinalized;
    await waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");

    for (const dir of [other, prefixOfPid, oldFormat]) {
      expect(existsSync(join(dir, "keep.txt"))).toBe(true);
    }
  });

  it("REQ-7 a failure to remove the dir does not change the exit handling", async () => {
    const manager = createManager();
    const { providerProcess } = await startBridge(manager);
    // Whatever the cleanup does, the exit must still finalise.
    providerProcess.child.kill("SIGKILL");
    await expect(providerProcess.exitFinalized).resolves.toBeUndefined();
  });

  // REQ-11: the first bridge start sweeps the temp dir in the background.
  it("REQ-11 the first bridge start removes an orphan dir of a dead pid without waiting for it", async () => {
    const dead = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const deadPid = dead.pid as number;
    await new Promise<void>((resolve) => dead.once("exit", () => resolve()));
    const orphan = join(tempRoot, `bb-provider-bridge-${deadPid}-fixture-old`);
    mkdirSync(join(orphan, "skills"), { recursive: true });
    symlinkSync(userFolder, join(orphan, "skills", "linked"), "junction");
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(orphan, longAgo, longAgo);
    const manager = createManager();

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    await waitFor(() => !existsSync(orphan), "the first bridge start to sweep the orphan");

    expect(existsSync(join(userFolder, "my-skill", "SKILL.md"))).toBe(true);
  });

  it("REQ-11 sweeps once, not on every bridge start", async () => {
    const manager = createManager();
    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const dead = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const deadPid = dead.pid as number;
    await new Promise<void>((resolve) => dead.once("exit", () => resolve()));
    const late = join(tempRoot, `bb-provider-bridge-${deadPid}-fixture-late`);
    mkdirSync(late);
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(late, longAgo, longAgo);

    await manager.ensureProvider({ processKey: "fake#bridge:bbbbbbbbbbbbbbbb", providerId: "fake" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(existsSync(late)).toBe(true);
  });
});

