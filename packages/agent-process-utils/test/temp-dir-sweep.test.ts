import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  lutimesSync,
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_TEMP_DIR_PREFIXES,
  createPluginProcessTempDir,
  sweepOrphanTempDirs,
  tempDirForEnv,
} from "../src/index.js";

// Acceptance tests for #552: REQ-6 (pid in the name), REQ-8 to REQ-10 (the
// orphan sweep). Real directories and real pids; no file system mocks.

const PREFIXES = PLUGIN_TEMP_DIR_PREFIXES;
const HOUR_MS = 60 * 60 * 1000;
const canChmodLock =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0;

/** A pid that belonged to a process this test started and reaped. */
async function reapedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("child did not start");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

describe("createPluginProcessTempDir (REQ-6)", () => {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("REQ-6 puts the current pid in the name when ownerPid is absent", async () => {
    const dir = await createPluginProcessTempDir({
      pluginId: "fixture",
      prefix: "zcc-host",
    });
    created.push(dir);
    const name = dir.split(/[\\/]/).pop() ?? "";
    expect(name).toMatch(new RegExp(`^zcc-host-${process.pid}@fixture-`));
    expect(existsSync(dir)).toBe(true);
  });

  it("REQ-6 puts an explicit ownerPid in the name", async () => {
    const dir = await createPluginProcessTempDir({
      pluginId: "fixture",
      prefix: "bb-provider-bridge",
      ownerPid: 424242,
    });
    created.push(dir);
    const name = dir.split(/[\\/]/).pop() ?? "";
    expect(name).toMatch(/^bb-provider-bridge-424242@fixture-/);
  });

  it("REQ-6 keeps an encoded plugin id in the name after the pid", async () => {
    const dir = await createPluginProcessTempDir({
      pluginId: "@scope/odd id",
      prefix: "zcc-host",
      ownerPid: 7,
    });
    created.push(dir);
    const name = dir.split(/[\\/]/).pop() ?? "";
    expect(name).toMatch(/^zcc-host-7@%40scope%2Fodd%20id-/);
  });
});

describe("sweepOrphanTempDirs", () => {
  let root: string;
  let alive: ReturnType<typeof spawn> | undefined;
  const locked: string[] = [];

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zcc-sweep-"));
  });

  afterEach(() => {
    alive?.kill();
    alive = undefined;
    for (const dir of locked.splice(0)) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // already gone
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  function makeDir(name: string, ageMs = HOUR_MS): string {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "marker.txt"), "x");
    const when = new Date(Date.now() - ageMs);
    utimesSync(dir, when, when);
    return dir;
  }

  /** Creating a child bumps a dir's mtime, so backdate after populating it. */
  function backdate(dir: string, ageMs = HOUR_MS): void {
    const when = new Date(Date.now() - ageMs);
    utimesSync(dir, when, when);
  }

    function sweep(extra: Partial<Parameters<typeof sweepOrphanTempDirs>[0]> = {}) {
    return sweepOrphanTempDirs({ tempRoot: root, prefixes: PREFIXES, ...extra });
  }

  function userFolder(): string {
    const folder = join(tmpdir(), `zcc-sweep-user-${process.pid}-${Date.now()}`);
    mkdirSync(join(folder, "my-skill"), { recursive: true });
    writeFileSync(join(folder, "my-skill", "SKILL.md"), "keep me\n");
    return folder;
  }

  describe("REQ-8: removes dead owners, leaves everything else", () => {
    it("REQ-8 removes dirs whose owner pid is dead, for both prefixes", async () => {
      const pid = await reapedPid();
      const bridge = makeDir(`bb-provider-bridge-${pid}@fixture-abc123`);
      const host = makeDir(`zcc-host-${pid}@fixture-def456`);

      const result = await sweep();

      expect(existsSync(bridge)).toBe(false);
      expect(existsSync(host)).toBe(false);
      expect(result.removed).toBe(2);
      expect(result.failed).toBe(0);
    });

    it("REQ-8 leaves a dir whose owner pid is a live process", async () => {
      alive = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], {
        stdio: "ignore",
      });
      const pid = alive.pid as number;
      const dir = makeDir(`bb-provider-bridge-${pid}@fixture-abc123`);

      const result = await sweep();

      expect(existsSync(dir)).toBe(true);
      expect(result.removed).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
    });

    it("REQ-8 leaves a dir owned by the current process", async () => {
      const dir = makeDir(`zcc-host-${process.pid}@fixture-abc123`);
      // Even a probe that says "dead" must not make the sweep delete our own.
      await sweep({ isAlive: () => false });
      expect(existsSync(dir)).toBe(true);
    });

    it("REQ-8 uses the injected liveness probe", async () => {
      const dir = makeDir("zcc-host-999999@fixture-abc123");
      await sweep({ isAlive: () => true });
      expect(existsSync(dir)).toBe(true);
      await sweep({ isAlive: () => false });
      expect(existsSync(dir)).toBe(false);
    });

    it("REQ-8 leaves a recent dir even when its owner pid is dead", async () => {
      const pid = await reapedPid();
      const dir = makeDir(`zcc-host-${pid}@fixture-abc123`, 60 * 1000);
      const result = await sweep();
      expect(existsSync(dir)).toBe(true);
      expect(result.removed).toBe(0);
    });

    it("REQ-8 uses the injected clock for the recent-dir guard", async () => {
      const pid = await reapedPid();
      const dir = makeDir(`zcc-host-${pid}@fixture-abc123`, 60 * 1000);
      await sweep({ now: () => Date.now() + HOUR_MS });
      expect(existsSync(dir)).toBe(false);
    });

    it("REQ-8 leaves old-format names without a pid", async () => {
      const dirs = [
        makeDir("bb-provider-bridge-fixture-abc123"),
        makeDir("zcc-host-fixture-abc123"),
      ];
      const result = await sweep({ isAlive: () => false });
      for (const dir of dirs) expect(existsSync(dir)).toBe(true);
      expect(result.removed).toBe(0);
    });

    it("REQ-8 leaves names that do not match a prefix or have no dash after the pid", async () => {
      const dirs = [
        makeDir("other-prefix-123456-fixture-abc"),
        makeDir("zcc-host-123456"),
        makeDir("xzcc-host-123456@fixture-abc"),
        makeDir("zcc-hosts-123456-fixture-abc"),
        makeDir("zcc-host-12ab-fixture-abc"),
      ];
      await sweep({ isAlive: () => false });
      for (const dir of dirs) expect(existsSync(dir)).toBe(true);
    });

    it("#552 leaves a legacy dir whose plugin id starts with digits (zcc-host-42-tools-abc)", async () => {
      const pid = await reapedPid();
      const dirs = [
        makeDir("zcc-host-42-tools-abc"),
        makeDir(`zcc-host-${pid}-tools-abc`),
        makeDir(`bb-provider-bridge-${pid}-fixture-abc`),
      ];
      const result = await sweep({ isAlive: () => false });
      for (const dir of dirs) expect(existsSync(dir)).toBe(true);
      expect(result.removed).toBe(0);
    });

    it("#552 live and recent dirs do not starve an orphan beyond the cap", async () => {
      for (let i = 0; i < 12; i += 1) makeDir(`zcc-host-${700000 + i}@fixture-live`);
      for (let i = 0; i < 6; i += 1) makeDir(`zcc-host-${710000 + i}@fixture-recent`, 1000);
      const orphan = makeDir("zcc-host-999000@fixture-orphan");
      const result = await sweep({
        isAlive: (pid) => pid >= 700000 && pid < 700012,
        maxEntries: 3,
      });
      expect(existsSync(orphan)).toBe(false);
      expect(result.removed).toBe(1);
      expect(result.skipped).toBe(18);
    });

    it("REQ-8 leaves a plain file whose name matches", async () => {
      const file = join(root, "zcc-host-999999@fixture-abc");
      writeFileSync(file, "x");
      await sweep({ isAlive: () => false });
      expect(existsSync(file)).toBe(true);
    });

    it("REQ-8 does nothing when the temp root does not exist", async () => {
      const result = await sweepOrphanTempDirs({
        tempRoot: join(root, "missing"),
        prefixes: PREFIXES,
      });
      expect(result).toEqual({ inspected: 0, removed: 0, skipped: 0, failed: 0 });
    });

    it("REQ-8 only considers the prefixes it is given", async () => {
      const dir = makeDir("bb-provider-bridge-999999@fixture-abc");
      await sweep({ prefixes: ["zcc-host"], isAlive: () => false });
      expect(existsSync(dir)).toBe(true);
    });
  });

  describe("REQ-9: link safety", () => {
    it("REQ-9 removes a leftover dir holding a link without touching the target", async () => {
      const target = userFolder();
      try {
        const dir = makeDir("bb-provider-bridge-999999@fixture-abc");
        mkdirSync(join(dir, "skills", "plugin"), { recursive: true });
        symlinkSync(target, join(dir, "skills", "plugin", "skills"), "junction");
        backdate(dir);

        const result = await sweep({ isAlive: () => false });

        expect(existsSync(dir)).toBe(false);
        expect(result.removed).toBe(1);
        expect(readFileSync(join(target, "my-skill", "SKILL.md"), "utf8")).toBe(
          "keep me\n",
        );
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });

    it("REQ-8 leaves a matching top-level symlink alone and removes the real dir beside it (CTX-5, OBL-008)", async () => {
      const target = userFolder();
      try {
        const link = join(root, "bb-provider-bridge-999999@fixture-link");
        symlinkSync(target, link, "junction");
        // Age the link itself, or the recency guard skips it for the wrong reason.
        const old = new Date(Date.now() - HOUR_MS);
        lutimesSync(link, old, old);
        const real = makeDir("bb-provider-bridge-999998@fixture-real");

        const result = await sweep({ isAlive: () => false });

        expect(existsSync(real)).toBe(false);
        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(existsSync(join(target, "my-skill", "SKILL.md"))).toBe(true);
        expect(result.removed).toBe(1);
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });

    it("REQ-9 leaves a top-level matching link in place and keeps its target", async () => {
      const target = userFolder();
      try {
        const link = join(root, "bb-provider-bridge-999999@fixture-abc");
        symlinkSync(target, link, "junction");

        await sweep({ isAlive: () => false });

        expect(lstatSync(link).isSymbolicLink()).toBe(true);
        expect(existsSync(join(target, "my-skill", "SKILL.md"))).toBe(true);
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    });
  });

  describe("tempDirForEnv", () => {
    it("reads the temp folder from the given environment, else os.tmpdir()", () => {
      const key = process.platform === "win32" ? "TEMP" : "TMPDIR";
      expect(tempDirForEnv({ [key]: "/somewhere/else" })).toBe("/somewhere/else");
      expect(tempDirForEnv({})).toBe(tmpdir());
      expect(tempDirForEnv({ [key]: "" })).toBe(tmpdir());
    });
  });

  describe("REQ-10: bounded, errors counted not thrown", () => {
    it("REQ-10 inspects at most maxEntries entries", async () => {
      for (let i = 0; i < 10; i += 1) {
        makeDir(`zcc-host-99999${i}@fixture-abc`);
      }
      const result = await sweep({ isAlive: () => false, maxEntries: 4 });
      expect(result.removed).toBe(4);
    });

    it("REQ-10 defaults to picking up at most 200 orphans, and removes at most 50", async () => {
      for (let i = 0; i < 230; i += 1) {
        makeDir(`zcc-host-${800000 + i}@fixture-abc`);
      }
      const result = await sweep({ isAlive: () => false });
      expect(result.inspected).toBe(200);
      expect(result.removed).toBe(50);
    });

    it("REQ-10 removes at most 50 dirs per sweep", async () => {
      for (let i = 0; i < 60; i += 1) {
        makeDir(`zcc-host-${900000 + i}@fixture-abc`);
      }
      const result = await sweep({ isAlive: () => false, maxEntries: 500 });
      expect(result.removed).toBe(50);
      const left = [...Array(60).keys()].filter((i) =>
        existsSync(join(root, `zcc-host-${900000 + i}@fixture-abc`)),
      );
      expect(left).toHaveLength(10);
    });

    it.skipIf(!canChmodLock)(
      "REQ-10 counts a dir that cannot be removed and carries on with the rest",
      async () => {
        const stuck = makeDir("zcc-host-999991@fixture-abc");
        const inner = join(stuck, "inner");
        mkdirSync(inner);
        backdate(stuck);
        chmodSync(inner, 0o000);
        locked.push(inner);
        const fine = makeDir("zcc-host-999992@fixture-abc");

        const result = await sweep({ isAlive: () => false });

        expect(result.failed).toBe(1);
        expect(result.removed).toBe(1);
        expect(existsSync(fine)).toBe(false);
        expect(existsSync(stuck)).toBe(true);
      },
    );

    it("REQ-10 swallows an error thrown by the liveness probe and counts it", async () => {
      const dir = makeDir("zcc-host-999993@fixture-abc");
      const result = await sweep({
        isAlive: () => {
          throw new Error("probe exploded");
        },
      });
      expect(result.failed).toBe(1);
      expect(existsSync(dir)).toBe(true);
    });
  });
});
