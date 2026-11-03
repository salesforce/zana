import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copySkillTree,
  createClaudeSkillPluginsRoot,
  defaultSkillLinkPolicy,
  ensureClaudeSkillPlugin,
} from "../skill-plugins.js";

const LIMITS = { maxDepth: 16, maxFiles: 2000, maxBytes: 16 * 1024 * 1024 };

function listTree(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    out.push(full);
    if (lstatSync(full).isDirectory()) out.push(...listTree(full));
  }
  return out;
}

/**
 * Links inside a user skills folder (#587). `~/.claude/skills` is mostly links
 * to skills installed elsewhere under the home folder, so a link is followed
 * when its target is under the home folder and is not a credential folder; the
 * copy always holds real files, never a link.
 */
describe("links inside a user skills folder are followed only under the home folder", () => {
  let base: string;
  let home: string;
  let skills: string;
  let outside: string;
  const policy = () => ({
    followLinksUnder: home,
    denyUnder: [join(home, ".ssh")],
  });

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-skill-links-"));
    home = join(base, "home");
    skills = join(home, ".claude", "skills");
    outside = join(base, "outside");
    mkdirSync(skills, { recursive: true });
    mkdirSync(join(home, ".agents", "skills", "linked-skill"), { recursive: true });
    writeFileSync(join(home, ".agents", "skills", "linked-skill", "SKILL.md"), "linked\n");
    writeFileSync(join(home, ".agents", "single.md"), "single\n");
    mkdirSync(join(home, ".ssh"), { recursive: true });
    writeFileSync(join(home, ".ssh", "id_rsa"), "PRIVATE KEY\n");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "outside\n");
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("copies a linked skill folder under the home folder as real files", () => {
    symlinkSync(join(home, ".agents", "skills", "linked-skill"), join(skills, "linked-skill"), "junction");
    const destination = join(base, "dest");

    const result = copySkillTree(skills, destination, LIMITS, policy());

    expect(readFileSync(join(destination, "linked-skill", "SKILL.md"), "utf8")).toBe("linked\n");
    expect(lstatSync(join(destination, "linked-skill")).isSymbolicLink()).toBe(false);
    expect(listTree(destination).filter((p) => lstatSync(p).isSymbolicLink())).toEqual([]);
    expect(result.skipped).toBe(0);
    expect(result.files).toBe(1);
  });

  it("copies a linked single file under the home folder as a real file", () => {
    symlinkSync(join(home, ".agents", "single.md"), join(skills, "single.md"));
    const destination = join(base, "dest");

    copySkillTree(skills, destination, LIMITS, policy());

    expect(lstatSync(join(destination, "single.md")).isSymbolicLink()).toBe(false);
    expect(readFileSync(join(destination, "single.md"), "utf8")).toBe("single\n");
  });

  it("skips and counts a link whose target is outside the home folder", () => {
    symlinkSync(outside, join(skills, "escape"), "junction");
    symlinkSync(join(outside, "secret.txt"), join(skills, "secret-link.txt"));
    const destination = join(base, "dest");

    const result = copySkillTree(skills, destination, LIMITS, policy());

    expect(result.skipped).toBe(2);
    expect(existsSync(join(destination, "escape"))).toBe(false);
    expect(existsSync(join(destination, "secret-link.txt"))).toBe(false);
  });

  it("skips a link into a credential folder even though it is under the home folder", () => {
    symlinkSync(join(home, ".ssh"), join(skills, "keys"), "junction");
    symlinkSync(join(home, ".ssh", "id_rsa"), join(skills, "key-link"));
    const destination = join(base, "dest");

    const result = copySkillTree(skills, destination, LIMITS, policy());

    expect(result.skipped).toBe(2);
    expect(listTree(destination).some((p) => p.includes("id_rsa") || p.endsWith("key-link"))).toBe(false);
  });

  it("skips a link that points back into the folder being copied, so nothing is copied twice or looped", () => {
    mkdirSync(join(skills, "real"), { recursive: true });
    writeFileSync(join(skills, "real", "SKILL.md"), "real\n");
    symlinkSync(join(skills, "real"), join(skills, "again"), "junction");
    symlinkSync(skills, join(skills, "real", "up"), "junction");
    const destination = join(base, "dest");

    const result = copySkillTree(skills, destination, LIMITS, policy());

    expect(result.files).toBe(1);
    expect(result.skipped).toBe(2);
    expect(existsSync(join(destination, "again"))).toBe(false);
  });

  it("copies a folder two links point at once, and skips the repeat", () => {
    symlinkSync(join(home, ".agents", "skills", "linked-skill"), join(skills, "first"), "junction");
    symlinkSync(join(home, ".agents", "skills", "linked-skill"), join(skills, "second"), "junction");
    const destination = join(base, "dest");

    const result = copySkillTree(skills, destination, LIMITS, policy());

    expect(result.files).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("skips a dangling link", () => {
    symlinkSync(join(home, ".agents", "gone"), join(skills, "dangling"));
    const result = copySkillTree(skills, join(base, "dest"), LIMITS, policy());
    expect(result.skipped).toBe(1);
    expect(result.files).toBe(0);
  });

  it("counts followed content against the file and size caps", () => {
    // Two files reached through links, so a cap of one file must trip on the followed content.
    mkdirSync(join(home, ".agents", "skills", "second-skill"), { recursive: true });
    writeFileSync(join(home, ".agents", "skills", "second-skill", "SKILL.md"), "second\n");
    symlinkSync(join(home, ".agents", "skills", "linked-skill"), join(skills, "linked-skill"), "junction");
    symlinkSync(join(home, ".agents", "skills", "second-skill"), join(skills, "second-skill"), "junction");
    expect(() =>
      copySkillTree(skills, join(base, "dest"), { ...LIMITS, maxFiles: 1 }, policy()),
    ).toThrow(/maxFiles/);
    expect(() =>
      copySkillTree(skills, join(base, "dest2"), { ...LIMITS, maxBytes: 1 }, policy()),
    ).toThrow(/maxBytes/);
  });

  it("follows nothing without a policy (the default for copySkillTree)", () => {
    symlinkSync(join(home, ".agents", "skills", "linked-skill"), join(skills, "linked-skill"), "junction");
    const result = copySkillTree(skills, join(base, "dest"), LIMITS);
    expect(result.skipped).toBe(1);
    expect(result.files).toBe(0);
  });

  it("the plugin copy of a user root follows links under the injected policy and keeps the plugin free of links", () => {
    symlinkSync(join(home, ".agents", "skills", "linked-skill"), join(skills, "linked-skill"), "junction");
    symlinkSync(outside, join(skills, "escape"), "junction");
    const pluginsRoot = createClaudeSkillPluginsRoot(base);

    const pluginPath = ensureClaudeSkillPlugin({
      pluginsRoot,
      root: { id: "native-claude-0", path: skills },
      linkPolicy: policy(),
    });

    const copied = join(pluginPath, "skills");
    expect(readFileSync(join(copied, "linked-skill", "SKILL.md"), "utf8")).toBe("linked\n");
    expect(existsSync(join(copied, "escape"))).toBe(false);
    expect(listTree(pluginsRoot).filter((p) => lstatSync(p).isSymbolicLink())).toEqual([]);
  });

  it("a changed link target is picked up on the next refresh", () => {
    symlinkSync(join(home, ".agents", "skills", "linked-skill"), join(skills, "linked-skill"), "junction");
    const pluginsRoot = createClaudeSkillPluginsRoot(base);
    const args = { pluginsRoot, root: { id: "native-claude-0", path: skills }, linkPolicy: policy() };
    const pluginPath = ensureClaudeSkillPlugin(args);
    writeFileSync(join(home, ".agents", "skills", "linked-skill", "SKILL.md"), "linked, edited and longer\n");

    ensureClaudeSkillPlugin(args);

    expect(readFileSync(join(pluginPath, "skills", "linked-skill", "SKILL.md"), "utf8")).toBe(
      "linked, edited and longer\n",
    );
  });

  it("the default policy follows links under the real home folder and refuses credential folders", () => {
    const real = defaultSkillLinkPolicy("/Users/someone");
    expect(real.followLinksUnder).toBe("/Users/someone");
    expect(real.denyUnder).toEqual(
      expect.arrayContaining([
        join("/Users/someone", ".ssh"),
        join("/Users/someone", ".aws"),
        join("/Users/someone", ".gnupg"),
      ]),
    );
  });
});
