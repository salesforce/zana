import {
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
import {
  removeTreeWithoutFollowingLinks,
  removeUnlessRealDirectory,
} from "../src/index.js";

describe("removeTreeWithoutFollowingLinks", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-remove-tree-"));
  });

  afterEach(() => {
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

  it("removes nested files and directories", () => {
    const tree = join(base, "tree");
    mkdirSync(join(tree, "a", "b"), { recursive: true });
    writeFileSync(join(tree, "a", "b", "file.txt"), "x");
    writeFileSync(join(tree, "top.txt"), "y");

    removeTreeWithoutFollowingLinks(tree);

    expect(existsSync(tree)).toBe(false);
  });

  it("removes a linked folder as a link and leaves its contents alone", () => {
    const target = userFolder();
    const tree = join(base, "bridge-temp");
    mkdirSync(join(tree, "skills", "plugin"), { recursive: true });
    writeFileSync(join(tree, "skills", "plugin", "plugin.json"), "{}");
    // The bridge's own layout: on Windows this is a directory junction.
    symlinkSync(target, join(tree, "skills", "plugin", "skills"), "junction");

    removeTreeWithoutFollowingLinks(tree);

    expect(existsSync(tree)).toBe(false);
    expect(readFileSync(join(target, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
    expect(existsSync(join(target, ".git", "HEAD"))).toBe(true);
  });

  it("removes a root that is itself a link without touching the target", () => {
    const target = userFolder();
    const link = join(base, "link");
    symlinkSync(target, link, "junction");

    removeTreeWithoutFollowingLinks(link);

    expect(existsSync(link)).toBe(false);
    expect(existsSync(join(target, "my-skill", "SKILL.md"))).toBe(true);
  });

  it("treats a missing root as already removed", () => {
    expect(() =>
      removeTreeWithoutFollowingLinks(join(base, "never-created")),
    ).not.toThrow();
  });
});

describe("removeUnlessRealDirectory", () => {
  let base: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-remove-unless-dir-"));
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("removes a link as a link and leaves its target alone", () => {
    const target = join(base, "target");
    mkdirSync(target);
    writeFileSync(join(target, "SKILL.md"), "keep me\n");
    const link = join(base, "skills");
    symlinkSync(target, link, "junction");

    expect(removeUnlessRealDirectory(link)).toBe(true);

    expect(existsSync(link)).toBe(false);
    expect(readFileSync(join(target, "SKILL.md"), "utf8")).toBe("keep me\n");
  });

  it("removes a link whose target is gone", () => {
    const target = join(base, "target");
    mkdirSync(target);
    const link = join(base, "skills");
    symlinkSync(target, link, "junction");
    rmSync(target, { recursive: true });

    expect(removeUnlessRealDirectory(link)).toBe(true);

    expect(existsSync(join(base, "skills"))).toBe(false);
  });

  it("removes a plain file", () => {
    const file = join(base, "skills");
    writeFileSync(file, "stale\n");

    expect(removeUnlessRealDirectory(file)).toBe(true);

    expect(existsSync(file)).toBe(false);
  });

  it("treats a missing path as removed", () => {
    expect(removeUnlessRealDirectory(join(base, "never-created"))).toBe(true);
  });

  it("leaves a real directory and its contents in place", () => {
    const directory = join(base, "skills");
    mkdirSync(join(directory, "mine"), { recursive: true });
    writeFileSync(join(directory, "mine", "SKILL.md"), "keep me\n");

    expect(removeUnlessRealDirectory(directory)).toBe(false);

    expect(readFileSync(join(directory, "mine", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
  });
});
