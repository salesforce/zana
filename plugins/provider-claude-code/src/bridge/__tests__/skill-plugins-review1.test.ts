import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  copySkillTree,
  createClaudeSkillPluginsRoot,
  createSkillCopyBudget,
  ensureClaudeSkillPlugin,
} from "../skill-plugins.js";

const LIMITS = { maxDepth: 16, maxFiles: 2000, maxBytes: 16 * 1024 * 1024 };

describe("review round 1 fixes (#587)", () => {
  let base: string;
  let src: string;
  let plugins: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-skill-review1-"));
    src = join(base, "skills");
    mkdirSync(join(src, "demo"), { recursive: true });
    writeFileSync(join(src, "demo", "SKILL.md"), "demo\n");
    plugins = createClaudeSkillPluginsRoot(base);
  });
  afterEach(() => rmSync(base, { recursive: true, force: true }));

  const ensure = (budget?: ReturnType<typeof createSkillCopyBudget>) =>
    ensureClaudeSkillPlugin({
      pluginsRoot: plugins,
      root: { id: "native-claude-0", path: src, owned: "user" },
      ...(budget === undefined ? {} : { budget }),
    });

  it("F2: many empty directories are capped as entries", () => {
    for (let i = 0; i < 9; i += 1) mkdirSync(join(src, `d${i}`));
    expect(() =>
      copySkillTree(src, join(base, "out"), { ...LIMITS, maxFiles: 2 }),
    ).toThrow(/maxEntries/u);
  });

  it.skipIf(process.platform === "win32")("F3: keeps the exec bit", () => {
    const script = join(src, "demo", "run.sh");
    writeFileSync(script, "#!/bin/sh\n");
    chmodSync(script, 0o755);
    copySkillTree(src, join(base, "out"), LIMITS);
    expect(statSync(join(base, "out", "demo", "run.sh")).mode & 0o777).toBe(0o700);
    expect(statSync(join(base, "out", "demo", "SKILL.md")).mode & 0o777).toBe(0o600);
  });

  it("F5/A3: a renamed skill folder is picked up", () => {
    const pluginPath = ensure();
    renameSync(join(src, "demo"), join(src, "renamed"));
    ensure();
    expect(existsSync(join(pluginPath, "skills", "renamed", "SKILL.md"))).toBe(true);
    expect(existsSync(join(pluginPath, "skills", "demo"))).toBe(false);
  });

  it("F7: an existing destination is refused and left intact", () => {
    const out = join(base, "out");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "keep\n");
    expect(() => copySkillTree(src, out, LIMITS)).toThrow(/already exists/u);
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("keep\n");
  });

  it("A5: a spent total budget skips the root with a 'total budget' error", () => {
    const budget = createSkillCopyBudget();
    budget.files = 0;
    expect(() => ensure(budget)).toThrow(/total budget/u);
    const late = createSkillCopyBudget(Date.now() - 60_000);
    expect(() => ensure(late)).toThrow(/total budget/u);
  });

  it("A5: roots within the budget draw it down and are copied", () => {
    const budget = createSkillCopyBudget();
    const before = budget.files;
    const pluginPath = ensure(budget);
    expect(budget.files).toBe(before - 1);
    expect(readdirSync(join(pluginPath, "skills")).includes("demo")).toBe(true);
  });

  it("Q1: a successful refresh leaves no .old- or .tmp- sibling", () => {
    const pluginPath = ensure();
    writeFileSync(join(src, "more.md"), "more\n");
    ensure();
    expect(
      readdirSync(pluginPath).filter((n) => /^\.(old|tmp)-/u.test(n)),
    ).toEqual([]);
    expect(existsSync(join(pluginPath, "skills", "more.md"))).toBe(true);
  });
});
