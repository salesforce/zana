import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type * as Fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createClaudeSkillPluginsRoot,
  ensureClaudeSkillPlugin,
} from "../skill-plugins.js";

// Lets a test make the Nth rename of a refresh fail (EBUSY on Windows).
const rename = vi.hoisted(() => ({ failOn: new Set<number>(), calls: 0 }));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof Fs>();
  const renameSync = ((from: Fs.PathLike, to: Fs.PathLike) => {
    rename.calls += 1;
    if (rename.failOn.has(rename.calls)) {
      throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
    }
    actual.renameSync(from, to);
  }) as typeof actual.renameSync;
  return { ...actual, renameSync };
});

describe("publishing a refreshed skill copy (#587)", () => {
  let base: string;
  let src: string;
  let plugins: string;

  beforeEach(() => {
    rename.failOn.clear();
    rename.calls = 0;
    base = mkdtempSync(join(tmpdir(), "zcc-skill-publish-"));
    src = join(base, "skills");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "a.md"), "a\n");
    plugins = createClaudeSkillPluginsRoot(base);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const ensure = (): string =>
    ensureClaudeSkillPlugin({
      pluginsRoot: plugins,
      root: { id: "native-claude-0", path: src, owned: "user" },
    });
  const siblings = (pluginPath: string): string[] =>
    readdirSync(pluginPath).filter((n) => /^\.(old|tmp)-/u.test(n));

  it("A8: moving the old copy aside fails: the old copy stays and the staged copy is removed", () => {
    const pluginPath = ensure();
    writeFileSync(join(src, "b.md"), "b\n");
    rename.calls = 0;
    rename.failOn.add(1); // skills -> .old-
    expect(() => ensure()).toThrow(/EBUSY/u);
    expect(readFileSync(join(pluginPath, "skills", "a.md"), "utf8")).toBe("a\n");
    expect(siblings(pluginPath)).toEqual([]);
  });

  it("Q1: renaming the new copy in fails: the old copy is put back and nothing is left over", () => {
    const pluginPath = ensure();
    writeFileSync(join(src, "b.md"), "b\n");
    rename.calls = 0;
    rename.failOn.add(2); // .tmp- -> skills
    expect(() => ensure()).toThrow(/EBUSY/u);
    expect(readFileSync(join(pluginPath, "skills", "a.md"), "utf8")).toBe("a\n");
    expect(existsSync(join(pluginPath, "skills", "b.md"))).toBe(false);
    expect(siblings(pluginPath)).toEqual([]);
  });

  it("A8: the restore also fails: the staged copy is still removed", () => {
    const pluginPath = ensure();
    writeFileSync(join(src, "b.md"), "b\n");
    rename.calls = 0;
    rename.failOn.add(2);
    rename.failOn.add(3); // .old- -> skills
    expect(() => ensure()).toThrow(/EBUSY/u);
    expect(readdirSync(pluginPath).filter((n) => n.startsWith(".tmp-"))).toEqual([]);
  });
});
