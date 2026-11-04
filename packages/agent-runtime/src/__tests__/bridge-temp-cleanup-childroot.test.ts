import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { useBridgeCleanupFixture } from "../test/bridge-temp-cleanup-harness.js";

// #552 review: the bridge child makes its temp dir under the temp folder of
// its own environment. The parent's TMPDIR is left alone here (not stubbed),
// so the parent's own os.tmpdir() is a different folder from the child's.

describe("bridge temp dir cleanup uses the child's temp folder (#552)", () => {
  const fx = useBridgeCleanupFixture({ stubParentTempDir: false });

  it("removes the dir the child made under its own TMPDIR, not the parent's", async () => {
    const manager = fx.createManager();
    const { bridgeDir, providerProcess } = await fx.startBridge(manager);
    expect(bridgeDir.startsWith(fx.tempRoot)).toBe(true);

    providerProcess.child.kill("SIGKILL");
    await providerProcess.exitFinalized;
    await fx.waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");

    expect(existsSync(bridgeDir)).toBe(false);
  });
});
