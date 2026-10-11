import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// ext4 allocates 8 blocks (4 KiB) to every directory, empty or not; APFS
// reports 0. Simulate ext4 so the measurement behaves the same on every machine.
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const lstat = (async (target: string, options?: { bigint?: boolean }) => {
    const stats = await fs.lstat(target, options as { bigint: true });
    if (stats.isDirectory()) stats.blocks = 8n;
    return stats;
  }) as typeof fs.lstat;
  return { ...fs, lstat };
});
const { measureTree } = await import("./disk-usage.js");

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "zcc-storage-ext4-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const base = { signal: new AbortController().signal, largeFileMinBytes: null, collectLargeFiles: false, maxFiles: 10_000, deadlineAt: Date.now() + 60_000 };

it("measures an emptied folder as zero, because clearing keeps the folder itself", async () => {
  const usage = await measureTree(dir, base);
  expect(usage).toMatchObject({ sizeBytes: 0, partial: false });
});

it("counts nested folders, which clearing does remove", async () => {
  await mkdir(path.join(dir, "a/b"), { recursive: true });
  await writeFile(path.join(dir, "a/b/one.bin"), Buffer.alloc(10_000, 1));
  const usage = await measureTree(dir, base);
  // Two nested folders at 4 KiB each, plus the file's own blocks.
  expect(usage!.sizeBytes).toBeGreaterThanOrEqual(2 * 4096 + 10_000);
  expect(usage!.sizeBytes).toBeLessThan(2 * 4096 + 100_000);
});
