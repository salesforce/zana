import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import type { ProviderAdapter } from "../provider-adapter.js";
import { RuntimeProviderProcessManager } from "../runtime-provider-process.js";
import { RuntimeThreadIdentityRegistry } from "../runtime-thread-identity.js";
import { createFakeAdapter } from "./runtime-test-harness.js";

/**
 * Shared harness of the bridge temp dir cleanup tests (#552): a stand-in
 * bridge process that makes its pid-named temp dir the way the real bridge
 * does, links a user folder into it, then idles until it is killed. It has no
 * exit handler, which is the crash / hard-kill case. Real processes and real
 * directories; the child's TMPDIR points at a private folder.
 */
const bridgeScript = `
const { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "bb-provider-bridge-" + process.pid + "@fixture-"));
mkdirSync(join(dir, "skills"), { recursive: true });
symlinkSync(process.env.TEST_USER_FOLDER, join(dir, "skills", "linked"), "junction");
writeFileSync(process.env.TEST_READY_FILE, dir);
setInterval(() => {}, 1000);
`;

export interface BridgeCleanupFixtureOptions {
  /** Also point this (parent) process's temp dir at the private folder. Defaults to true. */
  stubParentTempDir?: boolean;
}

export interface BridgeCleanupFixture {
  readonly base: string;
  /** The private temp folder the child uses. */
  readonly tempRoot: string;
  readonly userFolder: string;
  /** Lines the manager sent to `onStderr`. */
  readonly stderrLines: string[];
  createManager(opts?: { withoutOnStderr?: boolean }): RuntimeProviderProcessManager;
  waitFor(check: () => boolean, what: string): Promise<void>;
  startBridge(manager: RuntimeProviderProcessManager): Promise<{
    bridgeDir: string;
    providerProcess: ReturnType<RuntimeProviderProcessManager["requireProviderProcess"]>;
  }>;
}

/** Registers the per-test setup and teardown; call inside a `describe`. */
export function useBridgeCleanupFixture(
  options: BridgeCleanupFixtureOptions = {},
): BridgeCleanupFixture {
  const state = {
    base: "",
    tempRoot: "",
    userFolder: "",
    readyFile: "",
    scriptPath: "",
  };
  const managers: RuntimeProviderProcessManager[] = [];
  const stderrLines: string[] = [];

  beforeEach(() => {
    stderrLines.length = 0;
    state.base = mkdtempSync(join(tmpdir(), "zcc-bridge-cleanup-"));
    state.tempRoot = join(state.base, "tmp");
    mkdirSync(state.tempRoot);
    state.userFolder = join(state.base, "user-skills");
    mkdirSync(join(state.userFolder, "my-skill"), { recursive: true });
    writeFileSync(join(state.userFolder, "my-skill", "SKILL.md"), "keep me\n");
    state.readyFile = join(state.base, "ready.txt");
    state.scriptPath = join(state.base, "bridge.cjs");
    writeFileSync(state.scriptPath, bridgeScript);
    if (options.stubParentTempDir !== false) {
      vi.stubEnv("TMPDIR", state.tempRoot);
      vi.stubEnv("TEMP", state.tempRoot);
      vi.stubEnv("TMP", state.tempRoot);
    }
  });

  afterEach(async () => {
    await Promise.all(managers.splice(0).map((m) => m.shutdown()));
    vi.unstubAllEnvs();
    rmSync(state.base, { recursive: true, force: true });
  });

  function bridgeAdapter(): ProviderAdapter {
    const adapter = createFakeAdapter(state.scriptPath);
    return {
      ...adapter,
      process: { ...adapter.process, command: process.execPath, args: [state.scriptPath] },
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

  return {
    get base() { return state.base; },
    get tempRoot() { return state.tempRoot; },
    get userFolder() { return state.userFolder; },
    stderrLines,
    waitFor,
    createManager(opts = {}) {
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
          TEST_USER_FOLDER: state.userFolder,
          TEST_READY_FILE: state.readyFile,
          TMPDIR: state.tempRoot,
          TEMP: state.tempRoot,
          TMP: state.tempRoot,
        },
        getNextRequestId: () => nextRequestId++,
        handleStdoutLine: () => undefined,
        onProcessExit: vi.fn(),
        onProviderIdentityWaitersInterrupted: (providerProcess) =>
          identityRegistry.resolvePendingIdentityWaiters(providerProcess.identity),
        onProviderThreadDetached: (threadId) => identityRegistry.clearThread(threadId),
        ...(opts.withoutOnStderr
          ? {}
          : { onStderr: (line: string) => { stderrLines.push(line); } }),
        skillRoots: [],
        workspacePath: state.base,
      });
      managers.push(manager);
      return manager;
    },
    async startBridge(manager) {
      await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
      await waitFor(() => existsSync(state.readyFile), "the bridge to create its temp dir");
      const bridgeDir = readFileSync(state.readyFile, "utf8");
      const providerProcess = manager.requireProviderProcess({
        processKey: "fake",
        providerId: "fake",
      });
      return { bridgeDir, providerProcess };
    },
  };
}
