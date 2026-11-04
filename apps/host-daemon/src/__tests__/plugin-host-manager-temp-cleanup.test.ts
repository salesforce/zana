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

// Acceptance tests for #552, REQ-5: the three host plugin worker cleanup sites
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

  it("REQ-5 stop site: removes the worker temp dir with the link-safe async remove", async () => {
    const manager = createManager();
    const tempDir = await startWorker(manager);

    await dispose(manager);

    expect(hoisted.removeSpy).toHaveBeenCalledWith(tempDir);
    expect(existsSync(tempDir)).toBe(false);
  });

  it("REQ-5 stop site: keeps a linked user folder's files when the worker is stopped", async () => {
    const manager = createManager();
    const tempDir = await startWorker(manager);
    const userFolder = mkdtempSync(join(tmpdir(), "zcc-host-user-skills-"));
    cleanup.push(userFolder);
    mkdirSync(join(userFolder, "my-skill"));
    writeFileSync(join(userFolder, "my-skill", "SKILL.md"), "keep me\n");
    symlinkSync(userFolder, join(tempDir, "linked-skills"), "junction");

    await dispose(manager);

    expect(existsSync(tempDir)).toBe(false);
    expect(readFileSync(join(userFolder, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
    expect(hoisted.removeSpy).toHaveBeenCalled();
  });

  it("REQ-5 stop site: logs a warning and still resolves when the remove fails", async () => {
    const manager = createManager();
    await startWorker(manager);
    hoisted.removeSpy.mockRejectedValue(new Error("EBUSY: simulated"));

    await expect(dispose(manager)).resolves.toEqual({ disposed: true });

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "fixture" }),
      expect.stringMatching(/temporary directory/i),
    );
  });

  it("REQ-5 stop site: shutdown does not throw when the remove fails", async () => {
    const manager = createManager();
    await startWorker(manager);
    hoisted.removeSpy.mockRejectedValue(new Error("EBUSY: simulated"));

    await expect(manager.shutdown()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("REQ-5 close site: a worker that dies on its own has its temp dir removed link-safely", async () => {
    const manager = createManager();
    const tempDir = await startWorker(manager);

    await manager
      .call(callCommand({ method: "crash", callId: randomUUID() }))
      .catch(() => undefined);
    await waitFor(() => !existsSync(tempDir));

    expect(hoisted.removeSpy).toHaveBeenCalledWith(tempDir);
  });

  it("REQ-5 close site: a failed remove after the worker dies is logged as a warning", async () => {
    const manager = createManager();
    await startWorker(manager);
    hoisted.removeSpy.mockRejectedValue(new Error("EBUSY: simulated"));

    await manager
      .call(callCommand({ method: "crash", callId: randomUUID() }))
      .catch(() => undefined);
    await waitFor(() =>
      logger.warn.mock.calls.some(([, message]) =>
        /temporary directory/i.test(String(message)),
      ),
    );

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: "fixture" }),
      expect.stringMatching(/temporary directory/i),
    );
  });

  it("REQ-5 spawn-failure site: removes the temp dir link-safely and rethrows the spawn error", async () => {
    const manager = createManager();
    hoisted.forkError = new Error("spawn exploded");

    await expect(manager.call(callCommand())).rejects.toThrow("spawn exploded");

    expect(hoisted.removeSpy).toHaveBeenCalledTimes(1);
    const removed = hoisted.removeSpy.mock.calls[0]?.[0] as string;
    expect(removed).toMatch(/zcc-host-/);
    expect(existsSync(removed)).toBe(false);
  });

  it("REQ-5 spawn-failure site: rethrows the original spawn error even when the remove fails", async () => {
    const manager = createManager();
    hoisted.forkError = new Error("spawn exploded");
    hoisted.removeSpy.mockRejectedValue(new Error("EBUSY: simulated"));

    await expect(manager.call(callCommand())).rejects.toThrow("spawn exploded");
    expect(hoisted.removeSpy).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  it("REQ-6 (daemon side) the worker temp dir name carries the daemon pid", async () => {
    const manager = createManager();
    const tempDir = await startWorker(manager);
    const name = tempDir.split(/[\\/]/).pop() ?? "";
    expect(name).toMatch(new RegExp(`^zcc-host-${process.pid}@fixture-`));
  });

  // OBL-004 / REQ-11: one background sweep per daemon process, never awaited.
  it("REQ-11 sweeps once per process for both prefixes and never waits for it", async () => {
    vi.resetModules();
    const fresh = await import("../plugin-host-manager.js");
    // A sweep that never finishes must not delay construction or a call.
    hoisted.sweepSpy.mockReturnValue(new Promise(() => undefined));
    const make = () => {
      const manager = new fresh.PluginHostManager({
        dataDir,
        logger,
        fetchArtifact: vi.fn(async () => artifactSource),
      });
      managers.push(manager as unknown as InstanceType<typeof PluginHostManager>);
      return manager;
    };
    const first = make();
    make();

    expect(hoisted.sweepSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.sweepSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        prefixes: expect.arrayContaining(["bb-provider-bridge", "zcc-host"]),
      }),
    );
    await expect(first.call(callCommand())).resolves.toBeDefined();
  });

  it("REQ-11 a failing sweep is swallowed and does not reach the logger as an error throw", async () => {
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
    await expect(manager.call(callCommand())).resolves.toBeDefined();
  });
});

