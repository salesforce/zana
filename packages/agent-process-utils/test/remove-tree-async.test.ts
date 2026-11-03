import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { removeTreeWithoutFollowingLinksAsync } from "../src/index.js";

// Real directories only: the safety rule is about what the operating system
// does, so none of these tests replace the file system with a mock.
// Acceptance tests for #552, REQ-1 to REQ-4.

const canChmodLock =
  process.platform !== "win32" &&
  typeof process.getuid === "function" &&
  process.getuid() !== 0;

describe("removeTreeWithoutFollowingLinksAsync", () => {
  let base: string;
  const locked: string[] = [];

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-remove-tree-async-"));
  });

  afterEach(() => {
    for (const dir of locked.splice(0)) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // already gone
      }
    }
    rmSync(base, { recursive: true, force: true });
  });

  /** A folder the tree links to, standing in for `~/.claude/skills`. */
  function userFolder(): string {
    const folder = join(base, "user-skills");
    mkdirSync(join(folder, ".git"), { recursive: true });
    writeFileSync(join(folder, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(folder, "my-skill"), { recursive: true });
    writeFileSync(join(folder, "my-skill", "SKILL.md"), "keep me\n");
    return folder;
  }

  function expectUserFolderIntact(folder: string): void {
    expect(readFileSync(join(folder, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
    expect(existsSync(join(folder, ".git", "HEAD"))).toBe(true);
  }

  describe("REQ-1: deletes a tree like the sync remove", () => {
    it("REQ-1 removes nested files, directories and symlinks and the root", async () => {
      const tree = join(base, "tree");
      mkdirSync(join(tree, "a", "b"), { recursive: true });
      writeFileSync(join(tree, "a", "b", "file.txt"), "x");
      writeFileSync(join(tree, "top.txt"), "y");
      symlinkSync(join(tree, "top.txt"), join(tree, "a", "file-link"));

      await removeTreeWithoutFollowingLinksAsync(tree);

      expect(existsSync(tree)).toBe(false);
    });

    it("REQ-1 treats a missing root as a no-op", async () => {
      await expect(
        removeTreeWithoutFollowingLinksAsync(join(base, "never-created")),
      ).resolves.toBeUndefined();
    });

    it("REQ-1 removes an empty directory", async () => {
      const tree = join(base, "empty");
      mkdirSync(tree);
      await removeTreeWithoutFollowingLinksAsync(tree);
      expect(existsSync(tree)).toBe(false);
    });

    it("REQ-1 removes a single file given as the root", async () => {
      const file = join(base, "lonely.txt");
      writeFileSync(file, "x");
      await removeTreeWithoutFollowingLinksAsync(file);
      expect(existsSync(file)).toBe(false);
    });
  });

  describe("REQ-2: never deletes through a link", () => {
    it("REQ-2 removes a linked folder as a link and keeps the folder's files", async () => {
      const target = userFolder();
      const tree = join(base, "bridge-temp");
      mkdirSync(join(tree, "skills", "plugin"), { recursive: true });
      writeFileSync(join(tree, "skills", "plugin", "plugin.json"), "{}");
      symlinkSync(target, join(tree, "skills", "plugin", "skills"), "junction");

      await removeTreeWithoutFollowingLinksAsync(tree);

      expect(existsSync(tree)).toBe(false);
      expectUserFolderIntact(target);
    });

    it("REQ-2 removes several links to the same folder and keeps it", async () => {
      const target = userFolder();
      const tree = join(base, "tree");
      mkdirSync(tree);
      for (const name of ["one", "two", "three"]) {
        symlinkSync(target, join(tree, name), "junction");
      }

      await removeTreeWithoutFollowingLinksAsync(tree);

      expect(existsSync(tree)).toBe(false);
      expectUserFolderIntact(target);
    });

    it("REQ-2 unlinks a root that is itself a link and keeps its target", async () => {
      const target = userFolder();
      const root = join(base, "root-link");
      symlinkSync(target, root, "junction");

      await removeTreeWithoutFollowingLinksAsync(root);

      expect(existsSync(root)).toBe(false);
      expectUserFolderIntact(target);
    });

    it("REQ-2 removes a link whose target is gone without error", async () => {
      const target = userFolder();
      const tree = join(base, "tree");
      mkdirSync(tree);
      symlinkSync(target, join(tree, "dangling"), "junction");
      rmSync(target, { recursive: true, force: true });

      await removeTreeWithoutFollowingLinksAsync(tree);

      expect(existsSync(tree)).toBe(false);
    });

    it("REQ-2 removes a link to a folder inside the same tree without emptying it first", async () => {
      const tree = join(base, "tree");
      mkdirSync(join(tree, "real"), { recursive: true });
      writeFileSync(join(tree, "real", "file.txt"), "x");
      symlinkSync(join(tree, "real"), join(tree, "alias"), "junction");

      await removeTreeWithoutFollowingLinksAsync(tree);

      expect(existsSync(tree)).toBe(false);
    });
  });

  describe("REQ-3: stops at the first failure and throws", () => {
    it.skipIf(!canChmodLock)(
      "REQ-3 rejects when a directory cannot be read and leaves the tree on disk",
      async () => {
        const tree = join(base, "tree");
        const stuck = join(tree, "stuck");
        mkdirSync(stuck, { recursive: true });
        writeFileSync(join(stuck, "inner.txt"), "x");
        writeFileSync(join(tree, "a.txt"), "x");
        chmodSync(stuck, 0o000);
        locked.push(stuck);

        await expect(
          removeTreeWithoutFollowingLinksAsync(tree),
        ).rejects.toThrow(/EACCES|EPERM/);

        chmodSync(stuck, 0o700);
        expect(existsSync(tree)).toBe(true);
        expect(existsSync(join(stuck, "inner.txt"))).toBe(true);
      },
    );

    it.skipIf(!canChmodLock)(
      "REQ-3 keeps a linked folder's files when a sibling fails midway",
      async () => {
        const target = userFolder();
        const tree = join(base, "tree");
        const stuck = join(tree, "stuck");
        mkdirSync(stuck, { recursive: true });
        symlinkSync(target, join(tree, "skills"), "junction");
        chmodSync(stuck, 0o000);
        locked.push(stuck);

        await expect(
          removeTreeWithoutFollowingLinksAsync(tree),
        ).rejects.toThrow(/EACCES|EPERM/);

        expectUserFolderIntact(target);
      },
    );
  });

  describe("REQ-4: does not block the event loop", () => {
    it("REQ-4 returns a promise before touching the tree", async () => {
      const tree = join(base, "tree");
      mkdirSync(join(tree, "a"), { recursive: true });
      writeFileSync(join(tree, "a", "f.txt"), "x");

      const pending = removeTreeWithoutFollowingLinksAsync(tree);

      // A synchronous walk inside an async wrapper would already be done.
      expect(existsSync(tree)).toBe(true);
      await pending;
      expect(existsSync(tree)).toBe(false);
    });

    it("REQ-4 lets a timer scheduled before a large removal fire before it finishes", async () => {
      const tree = join(base, "big");
      for (let d = 0; d < 40; d += 1) {
        const dir = join(tree, `dir-${d}`, "nested");
        mkdirSync(dir, { recursive: true });
        for (let f = 0; f < 50; f += 1) {
          writeFileSync(join(dir, `file-${f}.txt`), "x");
        }
      }
      const order: string[] = [];
      let ticks = 0;
      const interval = setInterval(() => {
        ticks += 1;
      }, 1);
      setTimeout(() => order.push("timer"), 0);

      await removeTreeWithoutFollowingLinksAsync(tree);
      order.push("removed");
      clearInterval(interval);

      expect(order).toEqual(["timer", "removed"]);
      expect(ticks).toBeGreaterThan(1);
      expect(existsSync(tree)).toBe(false);
    });
  });
});
