import { describe, expect, it, vi, beforeEach } from "vitest";
import { useBridgeCleanupFixture } from "../test/bridge-temp-cleanup-harness.js";

const hoisted = vi.hoisted(() => ({
  sweep: vi.fn(),
  removeOwned: vi.fn(),
}));

vi.mock("@zana-ai/zcc-agent-process-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@zana-ai/zcc-agent-process-utils")>();
  return {
    ...actual,
    sweepOrphanTempDirs: (...args: unknown[]) => hoisted.sweep(...args),
    removeOwnedTempDirs: (...args: unknown[]) => hoisted.removeOwned(...args),
  };
});

// Failure reporting of the bridge temp dir cleanup (#552) with the helpers
// mocked, so each failure shape is reached on demand. The harness is shared.

describe("bridge temp dir cleanup failure reporting with mocked helpers (#552)", () => {
  const fx = useBridgeCleanupFixture();

  beforeEach(() => {
    hoisted.sweep.mockReset().mockResolvedValue({ inspected: 0, removed: 0, skipped: 0, failed: 0 });
    hoisted.removeOwned.mockReset().mockResolvedValue({ removed: 0, failures: [] });
  });

  it("F3 reports a sweep that rejects and still starts the bridge", async () => {
    hoisted.sweep.mockRejectedValue(new Error("sweep exploded"));
    const manager = fx.createManager();
    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    await fx.waitFor(() => fx.stderrLines.some((line) => /sweep failed: sweep exploded/.test(line)), "the sweep failure to be reported");
  });

  it("F3/A3 reports each dir the parent could not remove after the exit", async () => {
    hoisted.removeOwned.mockResolvedValue({
      removed: 0,
      failures: [{ path: "/tmp/x", error: new Error("EBUSY: simulated") }],
    });
    const manager = fx.createManager();
    const { providerProcess } = await fx.startBridge(manager);
    providerProcess.child.kill("SIGKILL");
    await expect(providerProcess.exitFinalized).resolves.toBeUndefined();
    await fx.waitFor(() => fx.stderrLines.some((line) => /EBUSY: simulated/.test(line)), "the removal failure to be reported");
  });

  it("F3/A3 reports a cleanup that throws and the exit still finalises", async () => {
    hoisted.removeOwned.mockRejectedValue("not an error object");
    const manager = fx.createManager();
    const { providerProcess } = await fx.startBridge(manager);
    providerProcess.child.kill("SIGKILL");
    await expect(providerProcess.exitFinalized).resolves.toBeUndefined();
    await fx.waitFor(() => fx.stderrLines.some((line) => /Could not clean up .*not an error object/.test(line)), "the cleanup error to be reported");
  });

  it("R2-F4 shutdown aborts the first-start sweep", async () => {
    let signal: AbortSignal | undefined;
    hoisted.sweep.mockImplementation((options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise(() => undefined);
    });
    const manager = fx.createManager();
    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    expect(signal?.aborted).toBe(false);

    await manager.shutdown();

    expect(signal?.aborted).toBe(true);
  });

  it("R2-F1 falls back to the console when the host sets no onStderr", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      hoisted.sweep.mockRejectedValue(new Error("sweep exploded"));
      const manager = fx.createManager({ withoutOnStderr: true });
      await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
      await fx.waitFor(() =>
        warn.mock.calls.some(([line]) => /sweep failed: sweep exploded/.test(String(line))),
        "the console warning",
      );
      expect(fx.stderrLines).toEqual([]);
    } finally {
      warn.mockRestore();
    }
  });

  it("R2-F5 reports the path of each orphan the sweep could not remove", async () => {
    hoisted.sweep.mockImplementation(
      async (options: { onFailure: (path: string, error: unknown) => void }) => {
        options.onFailure("/tmp/zcc-host-1@x", new Error("EBUSY: simulated"));
        return { inspected: 1, removed: 0, skipped: 0, failed: 1 };
      },
    );
    const manager = fx.createManager();
    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    await fx.waitFor(() =>
      fx.stderrLines.some((line) => /\/tmp\/zcc-host-1@x.*EBUSY: simulated/.test(line)),
      "the orphan path to be reported",
    );
  });
});
