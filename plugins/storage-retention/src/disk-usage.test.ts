import { chmod, link, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { allocatedBytes, measureTree } from "./disk-usage.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "zcc-storage-usage-"));
});
afterEach(async () => {
  await chmod(path.join(dir, "locked"), 0o700).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const base = { signal: new AbortController().signal, largeFileMinBytes: null, collectLargeFiles: false, maxFiles: 10_000, deadlineAt: Date.now() + 60_000 };
const file = (name: string, bytes: number) => writeFile(path.join(dir, name), Buffer.alloc(bytes, 1));

describe("measureTree", () => {
  it("sums allocated bytes across nested directories", async () => {
    await mkdir(path.join(dir, "a/b"), { recursive: true });
    await file("a/one.bin", 200_000);
    await file("a/b/two.bin", 300_000);
    const usage = await measureTree(dir, base);
    expect(usage).not.toBeNull();
    expect(usage!.sizeBytes).toBeGreaterThanOrEqual(500_000);
    expect(usage!.sizeBytes).toBeLessThan(2_000_000);
    expect(usage!.partial).toBe(false);
    expect(usage!.largeCount).toBe(0);
  });

  it("measures a single file root by its own allocation", async () => {
    await file("only.bin", 300_000);
    const stats = await lstat(path.join(dir, "only.bin"), { bigint: true });
    const usage = await measureTree(path.join(dir, "only.bin"), base);
    expect(usage!.sizeBytes).toBe(allocatedBytes(stats));
    expect(usage!.sizeBytes).toBeGreaterThanOrEqual(300_000);
  });

  it("aggregates large files and lists them only on request", async () => {
    await mkdir(path.join(dir, "a"));
    await file("a/big.bin", 400_000);
    await file("small.txt", 10);
    const counted = await measureTree(dir, { ...base, largeFileMinBytes: 100_000 });
    expect(counted).toMatchObject({ largeCount: 1, largeFiles: [] });
    expect(counted!.largeBytes).toBeGreaterThanOrEqual(400_000);
    const listed = await measureTree(dir, { ...base, largeFileMinBytes: 100_000, collectLargeFiles: true });
    expect(listed!.largeFiles.map((entry) => entry.path)).toEqual([path.join(dir, "a/big.bin")]);
    expect(listed!.largeTruncated).toBe(false);
  });

  it("caps the large-file list but keeps counting", async () => {
    for (let index = 0; index < 5; index++) await file(`big-${index}.bin`, 50_000);
    const usage = await measureTree(dir, { ...base, largeFileMinBytes: 40_000, collectLargeFiles: true, maxListedLargeFiles: 2 });
    expect(usage!.largeCount).toBe(5);
    expect(usage!.largeFiles).toHaveLength(2);
    expect(usage!.largeTruncated).toBe(true);
  });

  it("does not follow symbolic links out of the tree", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "zcc-storage-outside-"));
    try {
      await writeFile(path.join(outside, "huge.bin"), Buffer.alloc(900_000, 2));
      await mkdir(path.join(dir, "tree"));
      await symlink(outside, path.join(dir, "tree/escape"));
      await symlink(path.join(outside, "huge.bin"), path.join(dir, "tree/link.bin"));
      const usage = await measureTree(path.join(dir, "tree"), { ...base, largeFileMinBytes: 100_000 });
      expect(usage!.sizeBytes).toBeLessThan(100_000);
      expect(usage!.largeCount).toBe(0);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("counts a hard-linked file once", async () => {
    await file("original.bin", 300_000);
    await link(path.join(dir, "original.bin"), path.join(dir, "linked.bin"));
    const usage = await measureTree(dir, { ...base, largeFileMinBytes: 100_000 });
    expect(usage!.largeCount).toBe(1);
    expect(usage!.sizeBytes).toBeLessThan(600_000);
  });

  it("stops at the file cap and says the size is a lower bound", async () => {
    for (let index = 0; index < 40; index++) await file(`f-${index}.txt`, 1);
    const usage = await measureTree(dir, { ...base, maxFiles: 10 });
    expect(usage!.partial).toBe(true);
  });

  it("stops at the deadline and says the size is a lower bound", async () => {
    for (let index = 0; index < 10; index++) await file(`f-${index}.txt`, 1);
    const usage = await measureTree(dir, { ...base, deadlineAt: Date.now() - 1 });
    expect(usage!.partial).toBe(true);
  });

  it("rejects when aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(measureTree(dir, { ...base, signal: controller.signal })).rejects.toThrow("stop");
  });

  it("reports a missing root as null", async () => {
    expect(await measureTree(path.join(dir, "absent"), base)).toBeNull();
  });

  it.skipIf(process.getuid?.() === 0)("skips directories it cannot read and reports a lower bound", async () => {
    await mkdir(path.join(dir, "locked"));
    await writeFile(path.join(dir, "locked/hidden.bin"), "x");
    await file("ok.bin", 5_000);
    await chmod(path.join(dir, "locked"), 0o000);
    const usage = await measureTree(dir, base);
    expect(usage!.sizeBytes).toBeGreaterThan(0);
    expect(usage!.partial).toBe(true);
  });

  it("measures a single file root as itself", async () => {
    await file("only.bin", 20_000);
    const usage = await measureTree(path.join(dir, "only.bin"), base);
    expect(usage!.sizeBytes).toBeGreaterThanOrEqual(20_000);
  });
});
