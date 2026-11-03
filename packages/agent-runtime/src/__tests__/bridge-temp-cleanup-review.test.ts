import { spawn } from "node:child_process";
import {
  chmodSync,
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

describe("bridge temp dir cleanup reporting (#552 review round 1)", () => {
  let base: string;
  let tempRoot: string;
  let userFolder: string;
  let readyFile: string;
  let scriptPath: string;
  const managers: RuntimeProviderProcessManager[] = [];
  const stderrLines: string[] = [];

  beforeEach(() => {
    stderrLines.length = 0;
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
      onStderr: (line) => { stderrLines.push(line); },
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

  const canChmodLock =
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    process.getuid() !== 0;

  it.skipIf(!canChmodLock)(
    "F3/A3 reports a bridge temp dir it cannot remove, and the exit still finalises",
    async () => {
      const manager = createManager();
      const { bridgeDir, providerProcess } = await startBridge(manager);
      const locked = join(bridgeDir, "locked");
      mkdirSync(locked);
      writeFileSync(join(locked, "f.txt"), "x");
      chmodSync(locked, 0o000);
      try {
        providerProcess.child.kill("SIGKILL");
        await expect(providerProcess.exitFinalized).resolves.toBeUndefined();
        await waitFor(() => stderrLines.some((line) => /temporary directory/i.test(line)));
        expect(stderrLines.join("\n")).toContain(`pid ${providerProcess.child.pid}`);
        expect(existsSync(bridgeDir)).toBe(true);
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );

  it("A6 does not list the dirs of a pid that is not the exited child", async () => {
    const manager = createManager();
    const { bridgeDir, providerProcess } = await startBridge(manager);
    const unrelated = join(tempRoot, "bb-provider-bridge-1-fixture-keep");
    mkdirSync(unrelated);
    providerProcess.child.kill("SIGKILL");
    await providerProcess.exitFinalized;
    await waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");
    expect(existsSync(unrelated)).toBe(true);
  });
});
