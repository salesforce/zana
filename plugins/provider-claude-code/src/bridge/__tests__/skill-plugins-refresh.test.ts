import {
  chmodSync,
  lstatSync,
  symlinkSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  copySkillTree,
  createClaudeSkillPluginsRoot,
  createSkillCopyBudget,
  ensureClaudeSkillPlugin,
} from "../skill-plugins.js";

const LIMITS = { maxDepth: 16, maxFiles: 2000, maxBytes: 16 * 1024 * 1024 };

describe("user skill copy: caps, refresh and budget (#587)", () => {
  let base: string;
  let src: string;
  let plugins: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "zcc-skill-refresh-"));
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

  it("many empty directories are capped as entries", () => {
    for (let i = 0; i < 9; i += 1) mkdirSync(join(src, `d${i}`));
    expect(() =>
      copySkillTree(src, join(base, "out"), { ...LIMITS, maxFiles: 2 }),
    ).toThrow(/maxEntries/u);
  });

  it.skipIf(process.platform === "win32")("keeps the exec bit", () => {
    const script = join(src, "demo", "run.sh");
    writeFileSync(script, "#!/bin/sh\n");
    chmodSync(script, 0o755);
    copySkillTree(src, join(base, "out"), LIMITS);
    expect(statSync(join(base, "out", "demo", "run.sh")).mode & 0o777).toBe(0o700);
    expect(statSync(join(base, "out", "demo", "SKILL.md")).mode & 0o777).toBe(0o600);
  });

  it("a renamed skill folder is picked up", () => {
    const pluginPath = ensure();
    renameSync(join(src, "demo"), join(src, "renamed"));
    ensure();
    expect(existsSync(join(pluginPath, "skills", "renamed", "SKILL.md"))).toBe(true);
    expect(existsSync(join(pluginPath, "skills", "demo"))).toBe(false);
  });

  it("an existing destination is refused and left intact", () => {
    const out = join(base, "out");
    mkdirSync(out);
    writeFileSync(join(out, "keep.txt"), "keep\n");
    expect(() => copySkillTree(src, out, LIMITS)).toThrow(/already exists/u);
    expect(readFileSync(join(out, "keep.txt"), "utf8")).toBe("keep\n");
  });

  it("a spent total budget skips the root with a 'total budget' error", () => {
    const budget = createSkillCopyBudget();
    budget.files = 0;
    expect(() => ensure(budget)).toThrow(/total budget/u);
    const late = createSkillCopyBudget(Date.now() - 60_000);
    expect(() => ensure(late)).toThrow(/total budget/u);
  });

  it("roots within the budget draw it down and are copied", () => {
    const budget = createSkillCopyBudget();
    const before = budget.files;
    const pluginPath = ensure(budget);
    expect(budget.files).toBe(before - 1);
    expect(readdirSync(join(pluginPath, "skills")).includes("demo")).toBe(true);
  });

  it("a successful refresh leaves no .old- or .tmp- sibling", () => {
    const pluginPath = ensure();
    writeFileSync(join(src, "more.md"), "more\n");
    ensure();
    expect(
      readdirSync(pluginPath).filter((n) => /^\.(old|tmp)-/u.test(n)),
    ).toEqual([]);
    expect(existsSync(join(pluginPath, "skills", "more.md"))).toBe(true);
  });

  it("an unchanged plugin.json is not rewritten", () => {
    const pluginPath = ensure();
    const manifest = join(pluginPath, ".claude-plugin", "plugin.json");
    const old = new Date(Date.now() - 100_000);
    utimesSync(manifest, old, old);
    ensure();
    expect(lstatSync(manifest).mtimeMs).toBeLessThan(Date.now() - 50_000);
  });

  it("a huge flat directory is refused while it is listed", () => {
    for (let i = 0; i < 9; i += 1) writeFileSync(join(src, `f${i}`), "x");
    expect(() =>
      copySkillTree(src, join(base, "out"), { ...LIMITS, maxFiles: 2 }),
    ).toThrow(/maxEntries|maxFiles/u);
  });

  it("an unchanged root does not draw down the shared budget", () => {
    ensure(createSkillCopyBudget());
    const budget = createSkillCopyBudget();
    const before = { files: budget.files, bytes: budget.bytes };
    ensure(budget);
    expect(budget).toMatchObject(before);
  });

  it("a spent file budget does not fail a root that has not changed", () => {
    ensure(createSkillCopyBudget());
    const spent = createSkillCopyBudget();
    spent.files = 0;
    expect(() => ensure(spent)).not.toThrow();
  });

  describe("the budget deadline is enforced inside the scan and the copy", () => {
    afterEach(() => vi.restoreAllMocks());

    // Date.now answers "in time" for the first `okCalls` calls, then "late".
    const lateAfter = (okCalls: number) => {
      let calls = 0;
      vi.spyOn(Date, "now").mockImplementation(() => (++calls <= okCalls ? 0 : 1_000_000));
      const budget = createSkillCopyBudget(0);
      return budget;
    };

    it("aborts while walking a root that started in time", () => {
      expect(() => ensure(lateAfter(1))).toThrow(/time limit/u);
    });

    it("aborts while copying a root whose scan finished in time", () => {
      // 1 pre-check + 1 per listed entry and per walked entry: two for demo/, two for SKILL.md.
      expect(() => ensure(lateAfter(5))).toThrow(/time limit/u);
    });

    it("leaves no staged copy and no skills folder behind", () => {
      const budget = lateAfter(5);
      expect(() => ensure(budget)).toThrow(/time limit/u);
      const dirs = readdirSync(plugins).flatMap((d) => readdirSync(join(plugins, d)));
      expect(dirs.filter((n) => n.startsWith(".tmp-") || n === "skills")).toEqual([]);
    });
  });

  describe("an old skills link or stray file survives a failed refresh", () => {
    const stage = (): string => {
      const pluginPath = ensure();
      rmSync(join(pluginPath, "skills"), { recursive: true });
      const other = join(base, "other");
      mkdirSync(other);
      writeFileSync(join(other, "old.md"), "old\n");
      symlinkSync(other, join(pluginPath, "skills"), "junction");
      return pluginPath;
    };

    it("keeps the old link when the total budget is spent", () => {
      const pluginPath = stage();
      const budget = createSkillCopyBudget();
      budget.files = 0;
      expect(() => ensure(budget)).toThrow(/total budget/u);
      expect(lstatSync(join(pluginPath, "skills")).isSymbolicLink()).toBe(true);
      expect(readFileSync(join(pluginPath, "skills", "old.md"), "utf8")).toBe("old\n");
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "keeps the old link when a file cannot be read during the copy",
      () => {
        const pluginPath = stage();
        chmodSync(join(src, "demo", "SKILL.md"), 0o000);
        try {
          expect(() => ensure()).toThrow();
        } finally {
          chmodSync(join(src, "demo", "SKILL.md"), 0o600);
        }
        expect(lstatSync(join(pluginPath, "skills")).isSymbolicLink()).toBe(true);
        expect(readdirSync(pluginPath).filter((n) => n.startsWith(".tmp-"))).toEqual([]);
      },
    );

    it("replaces the old link with a real copy when the refresh succeeds", () => {
      const pluginPath = stage();
      ensure();
      expect(lstatSync(join(pluginPath, "skills")).isSymbolicLink()).toBe(false);
      expect(existsSync(join(pluginPath, "skills", "demo", "SKILL.md"))).toBe(true);
    });

    it("replaces a stray file with a real copy", () => {
      const pluginPath = ensure();
      rmSync(join(pluginPath, "skills"), { recursive: true });
      writeFileSync(join(pluginPath, "skills"), "stray\n");
      ensure();
      expect(existsSync(join(pluginPath, "skills", "demo", "SKILL.md"))).toBe(true);
    });
  });

  it("a link is skipped and its target not copied", () => {
    const secret = join(base, "secret");
    mkdirSync(secret);
    writeFileSync(join(secret, "token.txt"), "t");
    symlinkSync(secret, join(src, "escape"), "junction");
    const result = copySkillTree(src, join(base, "out"), LIMITS);
    expect(result.skipped).toBe(1);
    expect(existsSync(join(base, "out", "escape"))).toBe(false);
  });
});
