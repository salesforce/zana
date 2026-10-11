import { chmod, mkdir, mkdtemp, rename, rm, stat, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// The folder can change between the walk that lists large files and the
// deletion. Run the real walk, then let each test change the folder.
const walk = vi.hoisted(() => ({ after: null as null | (() => Promise<void>) }));
vi.mock("./disk-usage.js", async (original) => {
  const actual = await original<typeof import("./disk-usage.js")>();
  return {
    ...actual,
    measureTree: async (...args: Parameters<typeof actual.measureTree>) => {
      const usage = await actual.measureTree(...args);
      await walk.after?.();
      return usage;
    },
  };
});
const { discardLargeFiles } = await import("./host-storage.js");

const name = "00000000-0000-4000-8000-000000000001";
const BIG = 400_000;
let base: string;
let dir: string;
const env = () => ({
  threadStorageRoot: base,
  signal: new AbortController().signal,
  retainWorker: () => ({ dispose: async () => undefined }),
});
const exists = (target: string) => stat(target).then(() => true, () => false);

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "zcc-storage-recheck-"));
  dir = path.join(base, name);
  for (const file of ["kept.bin", "shrunk.bin", "replaced.bin", "vanished.bin", "sub/linked.bin", "locked/big.bin"]) {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), Buffer.alloc(BIG, 7));
  }
});
afterEach(async () => {
  walk.after = null;
  await chmod(path.join(dir, "locked"), 0o700).catch(() => undefined);
  await rm(base, { recursive: true, force: true });
});

it("re-checks each large file before deleting it and leaves any that changed since the walk", async () => {
  await rm(path.join(dir, "locked"), { recursive: true });
  walk.after = async () => {
    await truncate(path.join(dir, "shrunk.bin"), 10);
    await rm(path.join(dir, "replaced.bin"));
    await mkdir(path.join(dir, "replaced.bin"));
    await rm(path.join(dir, "vanished.bin"));
    // The file is still there, but reaching it now crosses a symbolic link.
    await rename(path.join(dir, "sub"), path.join(dir, "sub-real"));
    await symlink(path.join(dir, "sub-real"), path.join(dir, "sub"));
  };
  const result = await discardLargeFiles(env(), { names: [name], minBytes: 100_000 });
  expect(result.skipped).toEqual([]);
  expect(result.removed).toEqual([{ name, sizeBytes: expect.any(Number), count: 1 }]);
  expect(result.removed[0]!.sizeBytes).toBeGreaterThanOrEqual(BIG);
  expect(await exists(path.join(dir, "kept.bin"))).toBe(false);
  expect(await exists(path.join(dir, "shrunk.bin"))).toBe(true);
  expect((await stat(path.join(dir, "replaced.bin"))).isDirectory()).toBe(true);
  expect(await exists(path.join(dir, "sub-real/linked.bin"))).toBe(true);
});

it.skipIf(process.getuid?.() === 0)("stops on an unexpected error instead of treating the file as gone", async () => {
  walk.after = async () => {
    await chmod(path.join(dir, "locked"), 0o000);
  };
  await expect(discardLargeFiles(env(), { names: [name], minBytes: 100_000 })).rejects.toMatchObject({ code: "EACCES" });
});
