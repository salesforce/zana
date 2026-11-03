import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostRpcCommand } from "@zana-ai/zcc-contracts/host-rpc";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Review round 1 for #552 (A1, A5). Harness copied from the REQ-5 file.
// Original header: REQ-5: the three host plugin worker cleanup sites
// (spawn failure, worker close, worker stop) remove the temp dir with the
// link-safe async remove, warn on failure and never throw from the stop path.
// The workers are real processes and the directories are real; only the
// removal function is wrapped so a test can see it was the one used.

const hoisted = vi.hoisted(() => ({
  removeSpy: vi.fn(),
  sweepSpy: vi.fn(),
  forkError: null as Error | null,
}));

vi.mock("@zana-ai/zcc-agent-process-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@zana-ai/zcc-agent-process-utils")>();
  return {
    ...actual,
    removeTreeWithoutFollowingLinksAsync: (...args: unknown[]) =>
      hoisted.removeSpy(...args),
    sweepOrphanTempDirs: (...args: unknown[]) => hoisted.sweepSpy(...args),
  };
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    fork: ((...args: Parameters<typeof actual.fork>) => {
      if (hoisted.forkError !== null) throw hoisted.forkError;
      return actual.fork(...args);
    }) as typeof actual.fork,
  };
});

const { PluginHostManager } = await import("../plugin-host-manager.js");

type PluginCall = Extract<HostRpcCommand, { type: "plugin.host.call" }>;

const artifactSource = Buffer.from(`
const anySchema = { "~standard": { validate(value) { return { value }; } } };
export default {
  experimental_apiVersion: 1,
  contract: {
    paths: { input: anySchema, output: anySchema },
    crash: { input: anySchema, output: anySchema },
  },
  experimental_signals: {},
  handlers: {
    paths(_input, context) { return context.experimental_paths; },
    crash() { process.exit(17); },
  },
};
`);

function callCommand(overrides: Partial<PluginCall> = {}): PluginCall {
  return {
    type: "plugin.host.call",
    contributedEnv: [],
    pluginId: "fixture",
    generation: "generation-1",
    artifact: {
      digest: createHash("sha256").update(artifactSource).digest("hex"),
      byteLength: artifactSource.byteLength,
    },
    callId: randomUUID(),
    method: "paths",
    input: {},
    timeoutMs: 10_000,
    ...overrides,
  };
}

describe("PluginHostManager temp dir cleanup (#552)", () => {
  let dataDir: string;
  let logger: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
  const managers: InstanceType<typeof PluginHostManager>[] = [];
  const cleanup: string[] = [];

  beforeEach(async () => {
    const actual = await vi.importActual<
      typeof import("@zana-ai/zcc-agent-process-utils")
    >("@zana-ai/zcc-agent-process-utils");
    hoisted.removeSpy.mockReset();
    hoisted.sweepSpy.mockReset();
    hoisted.sweepSpy.mockResolvedValue({ inspected: 0, removed: 0, skipped: 0, failed: 0 });
    hoisted.removeSpy.mockImplementation((...args: unknown[]) =>
      actual.removeTreeWithoutFollowingLinksAsync(
        ...(args as Parameters<
          typeof actual.removeTreeWithoutFollowingLinksAsync
        >),
      ),
    );
    hoisted.forkError = null;
    dataDir = mkdtempSync(join(tmpdir(), "zcc-host-cleanup-test-"));
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
  });

  afterEach(async () => {
    hoisted.forkError = null;
    await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
    for (const dir of [dataDir, ...cleanup.splice(0)]) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function createManager(): InstanceType<typeof PluginHostManager> {
    const manager = new PluginHostManager({
      dataDir,
      logger,
      fetchArtifact: vi.fn(async () => artifactSource),
    });
    managers.push(manager);
    return manager;
  }

  async function startWorker(
    manager: InstanceType<typeof PluginHostManager>,
  ): Promise<string> {
    const result = await manager.call(callCommand());
    const tempDir = (result.output as { tempDir: string }).tempDir;
    expect(existsSync(tempDir)).toBe(true);
    return tempDir;
  }

  function dispose(manager: InstanceType<typeof PluginHostManager>) {
    return manager.dispose({
      type: "plugin.host.dispose",
      pluginId: "fixture",
      generation: "generation-1",
    });
  }

  async function waitFor(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 10_000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  it("A1 a normal stop of a worker with a non-empty temp dir logs no warning", async () => {
    const manager = createManager();
    const tempDir = await startWorker(manager);
    for (let d = 0; d < 5; d += 1) {
      mkdirSync(join(tempDir, `dir-${d}`));
      for (let f = 0; f < 10; f += 1) {
        writeFileSync(join(tempDir, `dir-${d}`, `file-${f}`), "x");
      }
    }

    await dispose(manager);

    expect(existsSync(tempDir)).toBe(false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("A1 removes the temp dir once per worker, not once at close and once at stop", async () => {
    const manager = createManager();
    const tempDir = await startWorker(manager);
    hoisted.removeSpy.mockClear();

    await dispose(manager);

    const removals = hoisted.removeSpy.mock.calls.filter(
      ([path]) => path === tempDir,
    );
    expect(removals).toHaveLength(1);
  });

  it("A5 shutdown aborts the startup sweep", async () => {
    vi.resetModules();
    const fresh = await import("../plugin-host-manager.js");
    hoisted.sweepSpy.mockReturnValue(new Promise(() => undefined));
    const manager = new fresh.PluginHostManager({
      dataDir,
      logger,
      fetchArtifact: vi.fn(async () => artifactSource),
    });
    const options = hoisted.sweepSpy.mock.calls.at(-1)?.[0] as {
      signal: AbortSignal;
    };
    expect(options.signal.aborted).toBe(false);

    await manager.shutdown();

    expect(options.signal.aborted).toBe(true);
  });

  it("A3 a failing startup sweep is reported as a warning", async () => {
    vi.resetModules();
    const fresh = await import("../plugin-host-manager.js");
    hoisted.sweepSpy.mockRejectedValue(new Error("sweep exploded"));
    const manager = new fresh.PluginHostManager({
      dataDir,
      logger,
      fetchArtifact: vi.fn(async () => artifactSource),
    });
    managers.push(manager as unknown as InstanceType<typeof PluginHostManager>);
    await waitFor(() => logger.warn.mock.calls.length > 0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Orphaned plugin temp directory sweep failed",
    );
  });
});
