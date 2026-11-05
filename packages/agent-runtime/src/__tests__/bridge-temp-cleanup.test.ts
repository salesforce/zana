import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useBridgeCleanupFixture } from "../test/bridge-temp-cleanup-harness.js";

// Acceptance tests for #552, REQ-7: after a bridge child exits, the agent
// runtime removes that child's `bb-provider-bridge-<pid>@*` temp dir under the
// temp dir link-safely, even though the child's own exit handler never ran
// (the child is a real process that is killed and never gets to clean up).
// Real processes and real directories. The harness is shared.

describe("bridge temp dir cleanup after the child exits (#552)", () => {
  const fx = useBridgeCleanupFixture();

  it("REQ-7 removes the exited child's temp dir and keeps the linked user folder", async () => {
    const manager = fx.createManager();
    const { bridgeDir, providerProcess } = await fx.startBridge(manager);
    expect(bridgeDir).toContain(`bb-provider-bridge-${providerProcess.child.pid}@`);
    expect(existsSync(bridgeDir)).toBe(true);

    // The child has no exit handler, so only the parent can clean up.
    await manager.shutdownProvider({ processKey: "fake", providerId: "fake" });
    await providerProcess.exitFinalized;
    await fx.waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");

    expect(existsSync(bridgeDir)).toBe(false);
    expect(readFileSync(join(fx.userFolder, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
  });

  it("REQ-7 removes the temp dir when the child crashes on its own", async () => {
    const manager = fx.createManager();
    const { bridgeDir, providerProcess } = await fx.startBridge(manager);

    providerProcess.child.kill("SIGKILL");
    await providerProcess.exitFinalized;
    await fx.waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");

    expect(existsSync(bridgeDir)).toBe(false);
    expect(existsSync(join(fx.userFolder, "my-skill", "SKILL.md"))).toBe(true);
  });

  it("REQ-7 does not touch another process's bridge dir or similarly named entries", async () => {
    const manager = fx.createManager();
    const { bridgeDir, providerProcess } = await fx.startBridge(manager);
    const childPid = providerProcess.child.pid as number;
    const other = join(fx.tempRoot, `bb-provider-bridge-${childPid + 1}@fixture-zzz`);
    const prefixOfPid = join(fx.tempRoot, `bb-provider-bridge-${childPid}0@fixture-zzz`);
    const oldFormat = join(fx.tempRoot, "bb-provider-bridge-fixture-zzz");
    for (const dir of [other, prefixOfPid, oldFormat]) {
      mkdirSync(dir);
      writeFileSync(join(dir, "keep.txt"), "x");
    }

    providerProcess.child.kill("SIGKILL");
    await providerProcess.exitFinalized;
    await fx.waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");

    for (const dir of [other, prefixOfPid, oldFormat]) {
      expect(existsSync(join(dir, "keep.txt"))).toBe(true);
    }
  });

  it("REQ-7 a failure to remove the dir does not change the exit handling", async () => {
    const manager = fx.createManager();
    const { providerProcess } = await fx.startBridge(manager);
    // Whatever the cleanup does, the exit must still finalise.
    providerProcess.child.kill("SIGKILL");
    await expect(providerProcess.exitFinalized).resolves.toBeUndefined();
  });

  // REQ-11: the first bridge start sweeps the temp dir in the background.
  it("REQ-11 the first bridge start removes an orphan dir of a dead pid without waiting for it", async () => {
    const dead = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const deadPid = dead.pid as number;
    await new Promise<void>((resolve) => dead.once("exit", () => resolve()));
    const orphan = join(fx.tempRoot, `bb-provider-bridge-${deadPid}@fixture-old`);
    mkdirSync(join(orphan, "skills"), { recursive: true });
    symlinkSync(fx.userFolder, join(orphan, "skills", "linked"), "junction");
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(orphan, longAgo, longAgo);
    const manager = fx.createManager();

    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    await fx.waitFor(() => !existsSync(orphan), "the first bridge start to sweep the orphan");

    expect(existsSync(join(fx.userFolder, "my-skill", "SKILL.md"))).toBe(true);
  });

  it("REQ-11 sweeps once, not on every bridge start", async () => {
    const manager = fx.createManager();
    await manager.ensureProvider({ processKey: "fake", providerId: "fake" });
    const dead = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
    const deadPid = dead.pid as number;
    await new Promise<void>((resolve) => dead.once("exit", () => resolve()));
    const late = join(fx.tempRoot, `bb-provider-bridge-${deadPid}@fixture-late`);
    mkdirSync(late);
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(late, longAgo, longAgo);

    await manager.ensureProvider({ processKey: "fake#bridge:bbbbbbbbbbbbbbbb", providerId: "fake" });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(existsSync(late)).toBe(true);
  });

  const canChmodLock =
    process.platform !== "win32" &&
    typeof process.getuid === "function" &&
    process.getuid() !== 0;

  it.skipIf(!canChmodLock)(
    "F3/A3 reports a bridge temp dir it cannot remove, and the exit still finalises",
    async () => {
      const manager = fx.createManager();
      const { bridgeDir, providerProcess } = await fx.startBridge(manager);
      const locked = join(bridgeDir, "locked");
      mkdirSync(locked);
      writeFileSync(join(locked, "f.txt"), "x");
      chmodSync(locked, 0o000);
      try {
        providerProcess.child.kill("SIGKILL");
        await expect(providerProcess.exitFinalized).resolves.toBeUndefined();
        await fx.waitFor(() => fx.stderrLines.some((line) => /temporary directory/i.test(line)));
        expect(fx.stderrLines.join("\n")).toContain(`pid ${providerProcess.child.pid}`);
        expect(existsSync(bridgeDir)).toBe(true);
      } finally {
        chmodSync(locked, 0o700);
      }
    },
  );

  it("A6 does not list the dirs of a pid that is not the exited child", async () => {
    const manager = fx.createManager();
    const { bridgeDir, providerProcess } = await fx.startBridge(manager);
    const unrelated = join(fx.tempRoot, "bb-provider-bridge-1@fixture-keep");
    mkdirSync(unrelated);
    providerProcess.child.kill("SIGKILL");
    await providerProcess.exitFinalized;
    await fx.waitFor(() => !existsSync(bridgeDir), "the parent to remove the bridge temp dir");
    expect(existsSync(unrelated)).toBe(true);
  });
});
