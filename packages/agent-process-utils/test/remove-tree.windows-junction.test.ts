import type * as Fs from "node:fs";
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  removeTreeWithoutFollowingLinks,
  removeUnlessRealDirectory,
} from "../src/index.js";

/**
 * Reproduces, on any OS, the two Windows behaviours behind the skills wipe:
 * a runtime that reports a directory junction as a plain directory and whose
 * recursive `rmSync` walks into it (libc++ inside Electron), and `unlink`
 * refusing a junction so only `rmdir` removes it.
 */
const windows = vi.hoisted(() => ({
  linksLookLikeDirectories: false,
  unlinkError: null as string | null,
  unlinkErrorFor: null as string | null,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const lstatSync = ((path: Fs.PathLike, options?: Fs.StatSyncOptions) => {
    const stat = actual.lstatSync(path, options);
    if (!windows.linksLookLikeDirectories || !stat?.isSymbolicLink()) {
      return stat;
    }
    return { isSymbolicLink: () => false, isDirectory: () => true };
  }) as typeof actual.lstatSync;
  const unlinkSync = ((path: Fs.PathLike) => {
    if (windows.unlinkError !== null && String(path) === windows.unlinkErrorFor) {
      throw Object.assign(new Error(windows.unlinkError), {
        code: windows.unlinkError,
      });
    }
    actual.unlinkSync(path);
  }) as typeof actual.unlinkSync;
  const rmdirSync = ((path: Fs.PathLike) => {
    // On Windows `rmdir` removes a junction itself; emulate that for links.
    if (actual.lstatSync(path).isSymbolicLink()) {
      actual.unlinkSync(path);
      return;
    }
    actual.rmdirSync(path);
  }) as typeof actual.rmdirSync;
  const rmSync = ((path: Fs.PathLike, options?: Fs.RmOptions) => {
    if (!windows.linksLookLikeDirectories || options?.recursive !== true) {
      actual.rmSync(path, options);
      return;
    }
    // Electron's libc++ `remove_all` on Windows walks a junction like a
    // directory, deleting the target's contents before the junction itself.
    const walk = (entry: string): void => {
      const stat = actual.statSync(entry, { throwIfNoEntry: false });
      if (stat === undefined) return;
      if (!stat.isDirectory()) {
        actual.unlinkSync(entry);
        return;
      }
      for (const name of actual.readdirSync(entry)) walk(join(entry, name));
      if (actual.lstatSync(entry).isSymbolicLink()) actual.unlinkSync(entry);
      else actual.rmdirSync(entry);
    };
    walk(String(path));
  }) as typeof actual.rmSync;
  return { ...actual, lstatSync, unlinkSync, rmdirSync, rmSync };
});

describe("removeTreeWithoutFollowingLinks on Windows-like runtimes", () => {
  let base: string;
  let target: string;
  let tree: string;
  let link: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-remove-tree-win-"));
    target = join(base, "user-skills");
    mkdirSync(join(target, ".git", "objects"), { recursive: true });
    writeFileSync(join(target, ".git", "objects", "ab12"), "blob");
    mkdirSync(join(target, "my-skill"), { recursive: true });
    writeFileSync(join(target, "my-skill", "SKILL.md"), "keep me\n");
    tree = join(base, "bridge-temp");
    mkdirSync(join(tree, "plugin"), { recursive: true });
    link = join(tree, "plugin", "skills");
    symlinkSync(target, link, "junction");
  });

  afterEach(() => {
    windows.linksLookLikeDirectories = false;
    windows.unlinkError = null;
    windows.unlinkErrorFor = null;
    rmSync(base, { recursive: true, force: true });
  });

  it("does not walk into a junction the runtime reports as a directory", () => {
    windows.linksLookLikeDirectories = true;

    removeTreeWithoutFollowingLinks(tree);

    expect(existsSync(tree)).toBe(false);
    expect(readFileSync(join(target, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
    expect(existsSync(join(target, ".git", "objects", "ab12"))).toBe(true);
  });

  it("does not walk into a root that is a junction reported as a directory", () => {
    windows.linksLookLikeDirectories = true;
    const rootLink = join(base, "root-link");
    symlinkSync(target, rootLink, "junction");

    removeTreeWithoutFollowingLinks(rootLink);

    expect(existsSync(rootLink)).toBe(false);
    expect(readFileSync(join(target, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
    expect(existsSync(join(target, ".git", "objects", "ab12"))).toBe(true);
  });

  it("removes a junction whose target is gone as a link", () => {
    windows.linksLookLikeDirectories = true;
    rmSync(target, { recursive: true, force: true });

    removeTreeWithoutFollowingLinks(tree);

    expect(existsSync(tree)).toBe(false);
  });

  it("removes a junction reported as a directory and reports a real directory", () => {
    windows.linksLookLikeDirectories = true;

    expect(removeUnlessRealDirectory(link)).toBe(true);
    expect(existsSync(link)).toBe(false);
    expect(existsSync(join(target, "my-skill", "SKILL.md"))).toBe(true);
    expect(removeUnlessRealDirectory(target)).toBe(false);
    expect(existsSync(join(target, "my-skill", "SKILL.md"))).toBe(true);
  });

  it("falls back to rmdir when unlink refuses a junction", () => {
    windows.unlinkError = "EPERM";
    windows.unlinkErrorFor = link;

    removeTreeWithoutFollowingLinks(tree);

    expect(existsSync(tree)).toBe(false);
    expect(existsSync(join(target, "my-skill", "SKILL.md"))).toBe(true);
  });

  it("stops at an unexpected failure and leaves the rest on disk", () => {
    windows.unlinkError = "EBUSY";
    windows.unlinkErrorFor = link;

    expect(() => removeTreeWithoutFollowingLinks(tree)).toThrow("EBUSY");

    expect(existsSync(tree)).toBe(true);
    expect(existsSync(join(target, "my-skill", "SKILL.md"))).toBe(true);
  });
});
