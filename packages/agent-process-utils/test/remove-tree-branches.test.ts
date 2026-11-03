import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  removeTreeWithoutFollowingLinks,
  removeTreeWithoutFollowingLinksAsync,
} from "../src/index.js";

// Error and platform branches of the sync and async walks (#552).

describe("remove-tree error and platform branches", () => {
  let base: string;
  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-remove-branches-"));
  });
  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("async rethrows a lookup error that is not ENOENT", async () => {
    const file = join(base, "file");
    writeFileSync(file, "x");
    await expect(
      removeTreeWithoutFollowingLinksAsync(join(file, "below")),
    ).rejects.toMatchObject({ code: "ENOTDIR" });
  });

  it("sync rethrows a lookup error that is not ENOENT", () => {
    const file = join(base, "file");
    writeFileSync(file, "x");
    expect(() =>
      removeTreeWithoutFollowingLinks(join(file, "below")),
    ).toThrowError(expect.objectContaining({ code: "ENOTDIR" }));
  });

  it("compares real paths case-insensitively on win32 for both walks", async () => {
    const platform = Object.getOwnPropertyDescriptor(process, "platform");
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const tree = join(base, "tree");
      mkdirSync(join(tree, "nested"), { recursive: true });
      removeTreeWithoutFollowingLinks(tree);
      expect(existsSync(tree)).toBe(false);

      mkdirSync(join(tree, "nested"), { recursive: true });
      await removeTreeWithoutFollowingLinksAsync(tree);
      expect(existsSync(tree)).toBe(false);
    } finally {
      if (platform) Object.defineProperty(process, "platform", platform);
    }
  });
});
