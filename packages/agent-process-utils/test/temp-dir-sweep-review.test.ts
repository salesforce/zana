import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLUGIN_TEMP_DIR_PREFIXES,
  removeOwnedTempDirs,
  removeTreeWithoutFollowingLinksAsync,
  sweepOrphanTempDirs,
} from "../src/index.js";

// Review round 1 for #552: reachability of the sweep on a crowded temp folder,
// overlapping removals, abort, and the parent-side per-pid removal.

const HOUR_MS = 60 * 60 * 1000;

async function reapedPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "0"], { stdio: "ignore" });
  const pid = child.pid;
  if (pid === undefined) throw new Error("child did not start");
  await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  return pid;
}

describe("temp dir sweep, review round 1", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "zcc-sweep-review-"));
  });
  afterEach(() => {
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

  it("F1/A2 reaches an orphan behind more than 200 unrelated entries", async () => {
    for (let i = 0; i < 300; i += 1) mkdirSync(join(root, `unrelated-${i}`));
    const orphan = makeDir("zcc-host-999999-fixture-abc");
    const result = await sweepOrphanTempDirs({
      tempRoot: root,
      prefixes: PLUGIN_TEMP_DIR_PREFIXES,
      isAlive: () => false,
    });
    expect(existsSync(orphan)).toBe(false);
    expect(result.removed).toBe(1);
  });

  it("F1/A2 counts only matching candidates towards maxEntries", async () => {
    for (let i = 0; i < 20; i += 1) mkdirSync(join(root, `unrelated-${i}`));
    for (let i = 0; i < 6; i += 1) makeDir(`zcc-host-99990${i}-fixture-abc`);
    const result = await sweepOrphanTempDirs({
      tempRoot: root,
      prefixes: PLUGIN_TEMP_DIR_PREFIXES,
      isAlive: () => false,
      maxEntries: 3,
    });
    expect(result.inspected).toBe(3);
    expect(result.removed).toBe(3);
  });

  it("A5 stops before touching anything when the signal is already aborted", async () => {
    const dir = makeDir("zcc-host-999999-fixture-abc");
    const controller = new AbortController();
    controller.abort();
    const result = await sweepOrphanTempDirs({
      tempRoot: root,
      prefixes: PLUGIN_TEMP_DIR_PREFIXES,
      isAlive: () => false,
      signal: controller.signal,
    });
    expect(existsSync(dir)).toBe(true);
    expect(result.inspected).toBe(0);
  });

  it("A1 two overlapping removals of one tree both succeed", async () => {
    const tree = join(root, "tree");
    for (let d = 0; d < 10; d += 1) {
      mkdirSync(join(tree, `dir-${d}`), { recursive: true });
      for (let f = 0; f < 20; f += 1) {
        writeFileSync(join(tree, `dir-${d}`, `file-${f}`), "x");
      }
    }
    await expect(
      Promise.all([
        removeTreeWithoutFollowingLinksAsync(tree),
        removeTreeWithoutFollowingLinksAsync(tree),
      ]),
    ).resolves.toBeDefined();
    expect(existsSync(tree)).toBe(false);
  });

  describe("removeOwnedTempDirs", () => {
    it("F2/A6 removes only the exact pid's dirs for the prefix", async () => {
      const pid = await reapedPid();
      const mine = makeDir(`bb-provider-bridge-${pid}-fixture-abc`, 0);
      const longer = makeDir(`bb-provider-bridge-${pid}0-fixture-abc`);
      const otherPrefix = makeDir(`zcc-host-${pid}-fixture-abc`);
      const result = await removeOwnedTempDirs({
        prefix: "bb-provider-bridge",
        pid,
        tempRoot: root,
      });
      expect(result.removed).toBe(1);
      expect(existsSync(mine)).toBe(false);
      expect(existsSync(longer)).toBe(true);
      expect(existsSync(otherPrefix)).toBe(true);
    });

    it("A6 leaves the dirs of a pid that is alive again", async () => {
      const dir = makeDir("bb-provider-bridge-4242-fixture-abc", 0);
      const result = await removeOwnedTempDirs({
        prefix: "bb-provider-bridge",
        pid: 4242,
        tempRoot: root,
        isAlive: () => true,
      });
      expect(result.removed).toBe(0);
      expect(existsSync(dir)).toBe(true);
    });

    it("an unknown pid matches nothing", async () => {
      const dir = makeDir("bb-provider-bridge-undefined-fixture-abc", 0);
      for (const pid of [undefined, 0, -1, 1.5]) {
        const result = await removeOwnedTempDirs({
          prefix: "bb-provider-bridge",
          pid,
          tempRoot: root,
        });
        expect(result).toEqual({ removed: 0, failures: [] });
      }
      expect(existsSync(dir)).toBe(true);
    });

    it("F3/A3 records a failure and still removes the other dirs", async () => {
      const pid = await reapedPid();
      const dir = makeDir(`bb-provider-bridge-${pid}-fixture-abc`, 0);
      const result = await removeOwnedTempDirs({
        prefix: "bb-provider-bridge",
        pid,
        tempRoot: join(root, "missing"),
      });
      expect(result).toEqual({ removed: 0, failures: [] });
      expect(existsSync(dir)).toBe(true);
    });
  });
});
