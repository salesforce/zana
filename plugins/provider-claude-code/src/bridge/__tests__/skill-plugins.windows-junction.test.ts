import type * as Fs from "node:fs";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClaudeSkillPluginsRoot,
  ensureClaudeSkillPlugin,
} from "../skill-plugins.js";

/**
 * Emulates, on any OS, the Windows behaviours behind the skills wipe: a
 * runtime that reports the `skills` junction as a plain directory and whose
 * recursive `rmSync` walks into it (libc++ inside Electron), and `unlink`
 * refusing a junction so only `rmdir` removes it.
 */
const windows = vi.hoisted(() => ({
  linksLookLikeDirectories: false,
  unlinkError: null as string | null,
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
    if (windows.unlinkError !== null) {
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

describe("claude skill plugins on Windows-like runtimes", () => {
  let baseDir: string;
  let userSkills: string;
  let otherRoot: string;
  let skillsLink: string;
  let pluginsRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "zcc-claude-skill-plugins-win-"));
    userSkills = join(baseDir, "user", ".claude", "skills");
    mkdirSync(join(userSkills, ".git"), { recursive: true });
    writeFileSync(join(userSkills, ".git", "HEAD"), "ref: refs/heads/main\n");
    mkdirSync(join(userSkills, "my-skill"), { recursive: true });
    writeFileSync(join(userSkills, "my-skill", "SKILL.md"), "keep me\n");
    otherRoot = join(baseDir, "other");
    mkdirSync(otherRoot, { recursive: true });

    pluginsRoot = createClaudeSkillPluginsRoot(baseDir);
    const pluginPath = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "native-claude-0", path: otherRoot },
    });
    skillsLink = join(pluginPath, "skills");
    // The link now points at the user's real folder, as after a catalog change.
    rmSync(skillsLink);
    symlinkSync(userSkills, skillsLink, "junction");
  });

  afterEach(() => {
    windows.linksLookLikeDirectories = false;
    windows.unlinkError = null;
    rmSync(baseDir, { recursive: true, force: true });
  });

  function repoint(): void {
    ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "native-claude-0", path: otherRoot },
    });
  }

  it("re-points a junction reported as a directory without emptying its target", () => {
    windows.linksLookLikeDirectories = true;

    repoint();

    expect(readlinkSync(skillsLink)).toBe(otherRoot);
    expect(readFileSync(join(userSkills, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
    expect(readFileSync(join(userSkills, ".git", "HEAD"), "utf8")).toContain(
      "refs/heads/main",
    );
  });

  it("re-points a junction reported as a directory whose target is gone", () => {
    windows.linksLookLikeDirectories = true;
    rmSync(skillsLink);
    const removed = join(baseDir, "removed");
    mkdirSync(removed);
    symlinkSync(removed, skillsLink, "junction");
    rmSync(removed, { recursive: true });

    repoint();

    expect(readlinkSync(skillsLink)).toBe(otherRoot);
  });

  it("removes the junction with rmdir when unlink refuses it", () => {
    windows.unlinkError = "EPERM";

    repoint();

    expect(readlinkSync(skillsLink)).toBe(otherRoot);
    expect(readFileSync(join(userSkills, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
  });

  it("gives up on an unexpected unlink failure without touching the target", () => {
    windows.unlinkError = "EBUSY";

    expect(repoint).toThrow("EBUSY");
    expect(readlinkSync(skillsLink)).toBe(userSkills);
    expect(readFileSync(join(userSkills, "my-skill", "SKILL.md"), "utf8")).toBe(
      "keep me\n",
    );
  });
});
