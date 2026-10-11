import { mkdir, mkdtemp, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { experimental_createHostEntryHarness } from "@zana-ai/zcc-plugin-sdk/testing/host";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import entry from "../host.js";
import { discardLargeFiles, measureEntries } from "./host-storage.js";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const trashName = (n: number, m = 1) => `.zcc-trash-${uuid(n)}-${uuid(1000 + m)}`;

let base: string;
let root: string;
let outside: string;
let harness: ReturnType<typeof open>;
const open = (threadStorageRoot: string | null = root) =>
  experimental_createHostEntryHarness(entry, {
    experimental_paths: { dataDir: path.join(base, "data"), tempDir: path.join(base, "temp"), threadStorageRoot },
  });

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "zcc-storage-host-"));
  root = path.join(base, "thread-storage");
  outside = path.join(base, "outside");
  await mkdir(root, { recursive: true });
  await mkdir(outside);
  harness = open();
});
afterEach(async () => {
  await harness.experimental_dispose();
  await rm(base, { recursive: true, force: true });
});

const thread = async (n: number, files: Record<string, number> = {}) => {
  const dir = path.join(root, uuid(n));
  await mkdir(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), Buffer.alloc(bytes, 7));
  }
  return dir;
};
const exists = (target: string) => stat(target).then(() => true, () => false);
async function settled() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (harness.experimental_getRetainedWorkerLeaseCount() === 0 && !(await readdir(root)).some((n) => n.startsWith(".zcc-trash-"))) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("trash was not cleaned up");
}
const measure = (names: string[], extra: Record<string, unknown> = {}) =>
  harness.experimental_call("measureEntries", { names, budgetMs: 60_000, maxFilesPerEntry: 100_000, largeFileMinBytes: null, ...extra } as never);

describe("layout", () => {
  it("lists only thread and trash folders, sorted, and reports disk capacity", async () => {
    await thread(2);
    await thread(1);
    await mkdir(path.join(root, trashName(3)));
    await mkdir(path.join(root, "model-list"));
    await mkdir(path.join(root, "provider-health"));
    await mkdir(path.join(root, "not-a-uuid"));
    await writeFile(path.join(root, uuid(9)), "a file named like a thread");
    const layout = await harness.experimental_call("layout", { after: null, limit: 100 });
    expect(layout.names).toEqual([trashName(3), uuid(1), uuid(2)].sort());
    expect(layout.next).toBeNull();
    expect(layout.disk!.totalBytes).toBeGreaterThan(0);
    expect(layout.disk!.freeBytes).toBeLessThanOrEqual(layout.disk!.totalBytes);
  });

  it("pages through large folders with a cursor", async () => {
    for (let n = 1; n <= 5; n++) await thread(n);
    const first = await harness.experimental_call("layout", { after: null, limit: 2 });
    expect(first.names).toEqual([uuid(1), uuid(2)]);
    expect(first.next).toBe(uuid(2));
    const second = await harness.experimental_call("layout", { after: first.next, limit: 2 });
    expect(second.names).toEqual([uuid(3), uuid(4)]);
    const last = await harness.experimental_call("layout", { after: second.next, limit: 2 });
    expect(last.names).toEqual([uuid(5)]);
    expect(last.next).toBeNull();
  });

  it("treats a missing root as empty and still reports disk capacity from the nearest parent", async () => {
    await rm(root, { recursive: true });
    const layout = await harness.experimental_call("layout", { after: null, limit: 10 });
    expect(layout.names).toEqual([]);
    expect(layout.disk!.totalBytes).toBeGreaterThan(0);
  });

  it("refuses to run without a thread-storage root", async () => {
    const bare = open(null);
    await expect(bare.experimental_call("layout", { after: null, limit: 10 })).rejects.toThrow(/thread-storage root/i);
    await bare.experimental_dispose();
  });

  it("follows a symlinked root to its real folder without listing anything else", async () => {
    await thread(1);
    const alias = path.join(base, "alias");
    await symlink(root, alias);
    const aliased = open(alias);
    expect((await aliased.experimental_call("layout", { after: null, limit: 10 })).names).toEqual([uuid(1)]);
    await aliased.experimental_dispose();
  });
});

describe("measureEntries", () => {
  it("measures each folder, aggregates large files and reports missing folders", async () => {
    await thread(1, { "a.bin": 300_000, "deep/b.bin": 200_000, "small.txt": 10 });
    await thread(2, { "tiny.txt": 5 });
    const result = await measure([uuid(1), uuid(2), uuid(3)], { largeFileMinBytes: 100_000 });
    const byName = new Map(result.entries.map((e) => [e.name, e]));
    expect(byName.get(uuid(1))!.sizeBytes).toBeGreaterThanOrEqual(500_000);
    expect(byName.get(uuid(1))).toMatchObject({ largeCount: 2, partial: false });
    expect(byName.get(uuid(1))!.largeBytes).toBeGreaterThanOrEqual(500_000);
    expect(byName.get(uuid(2))).toMatchObject({ largeCount: 0, largeBytes: 0 });
    expect(result.missing).toEqual([uuid(3)]);
    expect(result.skipped).toEqual([]);
  });

  it("marks a folder partial when it exceeds the file cap", async () => {
    await thread(1, Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f-${i}.txt`, 1])));
    const result = await measure([uuid(1)], { maxFilesPerEntry: 10 });
    expect(result.entries[0]).toMatchObject({ name: uuid(1), partial: true });
  });

  it("rejects names that are not thread or trash folders without measuring anything", async () => {
    await thread(1, { "a.txt": 1 });
    for (const bad of ["model-list", "../outside", "a/b", path.join(root, uuid(1)), "..", "."])
      await expect(measure([uuid(1), bad])).rejects.toThrow(/invalid storage entry/i);
  });

  it("does not follow a symlinked folder out of the root", async () => {
    await writeFile(path.join(outside, "huge.bin"), Buffer.alloc(800_000, 1));
    await symlink(outside, path.join(root, uuid(1)));
    const result = await measure([uuid(1)], { largeFileMinBytes: 100_000 });
    expect(result.entries[0]!.sizeBytes).toBeLessThan(100_000);
    expect(result.entries[0]!.largeCount).toBe(0);
  });

  it("reports everything missing when the root does not exist", async () => {
    await rm(root, { recursive: true });
    expect((await measure([uuid(1)])).missing).toEqual([uuid(1)]);
  });

  it("stops starting folders once the time budget is spent and reports the rest as skipped", async () => {
    for (let n = 1; n <= 3; n++) await thread(n, { "a.txt": 1 });
    let ticks = 0;
    const result = await measureEntries(
      { threadStorageRoot: root, signal: new AbortController().signal, retainWorker: () => ({ dispose: async () => undefined }), now: () => (ticks += 600) },
      { names: [uuid(1), uuid(2), uuid(3)], budgetMs: 1000, maxFilesPerEntry: 1000, largeFileMinBytes: null },
    );
    expect(result.entries.map((e) => e.name)).toEqual([uuid(1)]);
    expect(result.skipped).toEqual([uuid(2), uuid(3)]);
  });

  it("always makes progress even when the budget is already spent", async () => {
    await thread(1, { "a.txt": 1 });
    await thread(2, { "a.txt": 1 });
    let ticks = 0;
    const result = await measureEntries(
      { threadStorageRoot: root, signal: new AbortController().signal, retainWorker: () => ({ dispose: async () => undefined }), now: () => (ticks += 5_000) },
      { names: [uuid(1), uuid(2)], budgetMs: 1, maxFilesPerEntry: 1000, largeFileMinBytes: null },
    );
    expect(result.entries).toHaveLength(1);
    expect(result.skipped).toEqual([uuid(2)]);
  });

  it("stops when the call is aborted", async () => {
    await thread(1);
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(harness.experimental_call("measureEntries", { names: [uuid(1)], budgetMs: 1000, maxFilesPerEntry: 10, largeFileMinBytes: null }, { signal: controller.signal })).rejects.toThrow();
  });
});

describe("discard", () => {
  it("removes only the named folders and leaves the root and everything else alone", async () => {
    const gone = await thread(1, { "a.txt": 10, "deep/b.txt": 20 });
    const kept = await thread(2, { "a.txt": 10 });
    await mkdir(path.join(root, "model-list"));
    const result = await harness.experimental_call("discard", { names: [uuid(1)], recreate: false, minAgeMs: null });
    expect(result).toEqual({ removed: [uuid(1)], skipped: [], empty: [] });
    await settled();
    expect(await exists(gone)).toBe(false);
    expect(await exists(path.join(kept, "a.txt"))).toBe(true);
    expect(await exists(path.join(root, "model-list"))).toBe(true);
    expect(await exists(root)).toBe(true);
  });

  it("holds the worker open while the renamed folder is deleted in the background", async () => {
    await thread(1, { "a.txt": 10 });
    await harness.experimental_call("discard", { names: [uuid(1)], recreate: false, minAgeMs: null });
    await settled();
    expect(harness.experimental_getRetainedWorkerLeaseCount()).toBe(0);
  });

  it("recreates an emptied folder so a resumed thread finds its directory", async () => {
    const dir = await thread(1, { "a.txt": 10 });
    await harness.experimental_call("discard", { names: [uuid(1)], recreate: true, minAgeMs: null });
    await settled();
    expect(await readdir(dir)).toEqual([]);
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it("does not create a folder that was never there and reports it as empty", async () => {
    const result = await harness.experimental_call("discard", { names: [uuid(4)], recreate: true, minAgeMs: null });
    expect(result).toEqual({ removed: [], skipped: [], empty: [uuid(4)] });
    expect(await exists(path.join(root, uuid(4)))).toBe(false);
  });

  it("leaves an already-empty folder alone when recreating, so repeated clears are no-ops", async () => {
    const dir = await thread(1);
    const before = (await stat(dir)).ino;
    const result = await harness.experimental_call("discard", { names: [uuid(1)], recreate: true, minAgeMs: null });
    expect(result).toEqual({ removed: [], skipped: [], empty: [uuid(1)] });
    expect((await stat(dir)).ino).toBe(before);
    expect(await readdir(root)).toEqual([uuid(1)]);
  });

  it("still removes an empty folder when it is not being recreated", async () => {
    await thread(1);
    const result = await harness.experimental_call("discard", { names: [uuid(1)], recreate: false, minAgeMs: null });
    expect(result.removed).toEqual([uuid(1)]);
    await settled();
    expect(await exists(path.join(root, uuid(1)))).toBe(false);
  });

  it("refuses a symlinked folder and never touches its target", async () => {
    await writeFile(path.join(outside, "precious.txt"), "keep");
    await symlink(outside, path.join(root, uuid(1)));
    const result = await harness.experimental_call("discard", { names: [uuid(1)], recreate: false, minAgeMs: null });
    expect(result).toEqual({ removed: [], skipped: [uuid(1)], empty: [] });
    expect(await exists(path.join(outside, "precious.txt"))).toBe(true);
    expect((await stat(path.join(root, uuid(1)))).isDirectory()).toBe(true);
  });

  it("never follows a symlink inside a removed folder", async () => {
    const dir = await thread(1, { "a.txt": 1 });
    await writeFile(path.join(outside, "precious.txt"), "keep");
    await symlink(outside, path.join(dir, "escape"));
    await harness.experimental_call("discard", { names: [uuid(1)], recreate: false, minAgeMs: null });
    await settled();
    expect(await exists(dir)).toBe(false);
    expect(await exists(path.join(outside, "precious.txt"))).toBe(true);
  });

  it("refuses a regular file named like a thread", async () => {
    await writeFile(path.join(root, uuid(1)), "file");
    const result = await harness.experimental_call("discard", { names: [uuid(1)], recreate: false, minAgeMs: null });
    expect(result.skipped).toEqual([uuid(1)]);
    expect(await exists(path.join(root, uuid(1)))).toBe(true);
  });

  it("rejects the whole batch when any name is not a thread or trash folder", async () => {
    const kept = await thread(1, { "a.txt": 1 });
    for (const bad of ["model-list", "provider-health", "../outside", "a/b", "..", ".", "", path.join(root, uuid(1)), `${uuid(1)}/..`]) {
      await expect(harness.experimental_call("discard", { names: [uuid(1), bad], recreate: false, minAgeMs: null })).rejects.toThrow();
    }
    expect(await exists(path.join(kept, "a.txt"))).toBe(true);
    expect(await exists(path.join(root, "model-list"))).toBe(false);
  });

  it("will not recreate a trash folder", async () => {
    await mkdir(path.join(root, trashName(1)));
    await expect(harness.experimental_call("discard", { names: [trashName(1)], recreate: true, minAgeMs: null })).rejects.toThrow(/trash/i);
  });

  it("removes leftover trash folders on request", async () => {
    await mkdir(path.join(root, trashName(1)));
    await writeFile(path.join(root, trashName(1), "x"), "x");
    const result = await harness.experimental_call("discard", { names: [trashName(1)], recreate: false, minAgeMs: null });
    expect(result.removed).toEqual([trashName(1)]);
    await settled();
    expect(await exists(path.join(root, trashName(1)))).toBe(false);
  });

  it("skips folders touched more recently than the minimum age", async () => {
    const fresh = await thread(1, { "a.txt": 1 });
    const old = await thread(2, { "a.txt": 1 });
    const longAgo = new Date(Date.now() - 3_600_000);
    await utimes(path.join(old, "a.txt"), longAgo, longAgo);
    await utimes(old, longAgo, longAgo);
    const result = await harness.experimental_call("discard", { names: [uuid(1), uuid(2)], recreate: false, minAgeMs: 600_000 });
    expect(result).toEqual({ removed: [uuid(2)], skipped: [uuid(1)], empty: [] });
    await settled();
    expect(await exists(fresh)).toBe(true);
    expect(await exists(old)).toBe(false);
  });

  it("skips an old folder when anything deep inside it was written recently", async () => {
    const dir = await thread(3);
    const nested = path.join(dir, "a", "b");
    await mkdir(nested, { recursive: true });
    await writeFile(path.join(nested, "live.log"), "x");
    const longAgo = new Date(Date.now() - 3_600_000);
    // Only the file is fresh: every folder on the way looks old.
    for (const folder of [nested, path.join(dir, "a"), dir]) await utimes(folder, longAgo, longAgo);
    const result = await harness.experimental_call("discard", { names: [uuid(3)], recreate: false, minAgeMs: 600_000 });
    expect(result).toEqual({ removed: [], skipped: [uuid(3)], empty: [] });
    expect(await exists(path.join(nested, "live.log"))).toBe(true);
    await utimes(path.join(nested, "live.log"), longAgo, longAgo);
    for (const folder of [nested, path.join(dir, "a"), dir]) await utimes(folder, longAgo, longAgo);
    expect((await harness.experimental_call("discard", { names: [uuid(3)], recreate: false, minAgeMs: 600_000 })).removed).toEqual([uuid(3)]);
    await settled();
  });

  it("does not follow a symbolic link while checking an orphan folder's age", async () => {
    const dir = await thread(4);
    const outside = await mkdtemp(path.join(tmpdir(), "zcc-storage-outside-"));
    try {
      await writeFile(path.join(outside, "fresh.txt"), "x");
      const longAgo = new Date(Date.now() - 3_600_000);
      await symlink(outside, path.join(dir, "link"));
      await utimes(dir, longAgo, longAgo);
      const { lutimes } = await import("node:fs/promises");
      await lutimes(path.join(dir, "link"), longAgo, longAgo);
      await utimes(dir, longAgo, longAgo);
      const result = await harness.experimental_call("discard", { names: [uuid(4)], recreate: false, minAgeMs: 600_000 });
      expect(result.removed).toEqual([uuid(4)]);
      await settled();
      expect(await exists(path.join(outside, "fresh.txt"))).toBe(true);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("treats a folder that vanished as already gone", async () => {
    expect(await harness.experimental_call("discard", { names: [uuid(7)], recreate: false, minAgeMs: null })).toEqual({ removed: [], skipped: [], empty: [uuid(7)] });
  });

  it("does nothing when the root is missing", async () => {
    await rm(root, { recursive: true });
    expect(await harness.experimental_call("discard", { names: [uuid(1)], recreate: true, minAgeMs: null })).toEqual({ removed: [], skipped: [], empty: [uuid(1)] });
    expect(await exists(root)).toBe(false);
  });

  it("refuses to run without a thread-storage root", async () => {
    const bare = open(null);
    await expect(bare.experimental_call("discard", { names: [uuid(1)], recreate: false, minAgeMs: null })).rejects.toThrow(/thread-storage root/i);
    await bare.experimental_dispose();
  });
});

describe("discardLargeFiles", () => {
  it("removes only large regular files inside the named folder", async () => {
    const dir = await thread(1, { "big.bin": 400_000, "deep/also-big.bin": 300_000, "small.txt": 10 });
    const other = await thread(2, { "big.bin": 400_000 });
    const result = await harness.experimental_call("discardLargeFiles", { names: [uuid(1)], minBytes: 100_000 });
    expect(result.skipped).toEqual([]);
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]).toMatchObject({ name: uuid(1), count: 2 });
    expect(result.removed[0]!.sizeBytes).toBeGreaterThanOrEqual(700_000);
    expect(await exists(path.join(dir, "big.bin"))).toBe(false);
    expect(await exists(path.join(dir, "deep/also-big.bin"))).toBe(false);
    expect(await exists(path.join(dir, "small.txt"))).toBe(true);
    expect(await exists(path.join(other, "big.bin"))).toBe(true);
    expect(await exists(dir)).toBe(true);
  });

  it("never follows a symlink to a large file elsewhere", async () => {
    const dir = await thread(1, { "a.txt": 1 });
    await writeFile(path.join(outside, "huge.bin"), Buffer.alloc(800_000, 1));
    await symlink(path.join(outside, "huge.bin"), path.join(dir, "link.bin"));
    await symlink(outside, path.join(dir, "escape"));
    const result = await harness.experimental_call("discardLargeFiles", { names: [uuid(1)], minBytes: 100_000 });
    expect(result.removed[0]).toMatchObject({ count: 0, sizeBytes: 0 });
    expect(await exists(path.join(outside, "huge.bin"))).toBe(true);
  });

  it("skips a symlinked folder and a missing one", async () => {
    await writeFile(path.join(outside, "huge.bin"), Buffer.alloc(800_000, 1));
    await symlink(outside, path.join(root, uuid(1)));
    const result = await harness.experimental_call("discardLargeFiles", { names: [uuid(1), uuid(2)], minBytes: 100_000 });
    expect(result).toEqual({ removed: [], skipped: [uuid(1)] });
    expect(await exists(path.join(outside, "huge.bin"))).toBe(true);
  });

  it("reports a folder it ran out of time on as unfinished, deleting nothing it did not reach", async () => {
    const dir = await thread(1, { "big.bin": 400_000 });
    const env = {
      threadStorageRoot: root,
      signal: new AbortController().signal,
      retainWorker: () => ({ dispose: async () => undefined }),
      clearLargeBudgetMs: -1,
    };
    const result = await discardLargeFiles(env, { names: [uuid(1)], minBytes: 100_000 });
    expect(result.skipped).toEqual([uuid(1)]);
    expect(result.removed).toEqual([{ name: uuid(1), sizeBytes: 0, count: 0 }]);
    expect(await exists(path.join(dir, "big.bin"))).toBe(true);
  });

  it("does nothing when the root is missing", async () => {
    await rm(root, { recursive: true });
    expect(await harness.experimental_call("discardLargeFiles", { names: [uuid(1)], minBytes: 100_000 })).toEqual({ removed: [], skipped: [] });
    expect(await exists(root)).toBe(false);
  });

  it("rejects names that are not thread folders", async () => {
    await expect(harness.experimental_call("discardLargeFiles", { names: ["model-list"], minBytes: 100_000 })).rejects.toThrow(/invalid storage entry/i);
    await expect(harness.experimental_call("discardLargeFiles", { names: [trashName(1)], minBytes: 100_000 })).rejects.toThrow(/invalid storage entry/i);
  });

  it("refuses to run without a thread-storage root", async () => {
    const bare = open(null);
    await expect(bare.experimental_call("discardLargeFiles", { names: [uuid(1)], minBytes: 100_000 })).rejects.toThrow(/thread-storage root/i);
    await bare.experimental_dispose();
  });
});
