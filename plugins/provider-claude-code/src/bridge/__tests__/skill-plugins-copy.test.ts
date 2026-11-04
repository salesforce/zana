import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CLAUDE_SKILL_PLUGIN_NAME,
  copySkillTree,
  createClaudeSkillPluginsRoot,
  ensureClaudeSkillPlugin,
} from "../skill-plugins.js";

const MARKER = ".zcc-skill-copy";
const LIMITS = { maxDepth: 16, maxFiles: 2000, maxBytes: 16 * 1024 * 1024 };
const canChmod = process.platform !== "win32" && process.getuid?.() !== 0;

function isLink(path: string): boolean {
  return lstatSync(path).isSymbolicLink();
}

function listTree(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    out.push(full);
    if (lstatSync(full).isDirectory()) out.push(...listTree(full));
  }
  return out;
}

describe("claude skill plugins copy user-owned roots (#587)", () => {
  let baseDir: string;
  let userSkills: string;
  let secret: string;
  let pluginsRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "zcc-claude-skill-copy-test-"));
    userSkills = join(baseDir, "home", ".claude", "skills");
    mkdirSync(join(userSkills, "demo"), { recursive: true });
    writeFileSync(
      join(userSkills, "demo", "SKILL.md"),
      "---\nname: demo\ndescription: demo\n---\n",
    );
    writeFileSync(join(userSkills, "top.md"), "top\n");
    secret = join(baseDir, "secret");
    mkdirSync(secret, { recursive: true });
    writeFileSync(join(secret, "token.txt"), "do not copy\n");
    pluginsRoot = createClaudeSkillPluginsRoot(baseDir);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  function ensureUser(
    extra: { id?: string; path?: string; owned?: "user" | "zana" } = {},
    takenNames?: Map<string, string>,
  ): string {
    return ensureClaudeSkillPlugin({
      pluginsRoot,
      root: {
        id: extra.id ?? "native-claude-0",
        path: extra.path ?? userSkills,
        ...(extra.owned === undefined ? {} : { owned: extra.owned }),
      },
      ...(takenNames === undefined ? {} : { takenNames }),
    });
  }

  describe("REQ-1 user-owned root is copied", () => {
    it("REQ-1: copies a user-owned root as real files and creates no link", () => {
      const pluginPath = ensureUser({ owned: "user" });
      const skills = join(pluginPath, "skills");
      expect(isLink(skills)).toBe(false);
      expect(lstatSync(skills).isDirectory()).toBe(true);
      expect(readFileSync(join(skills, "demo", "SKILL.md"), "utf8")).toContain(
        "name: demo",
      );
      expect(readFileSync(join(skills, "top.md"), "utf8")).toBe("top\n");
      expect(listTree(pluginsRoot).filter(isLink)).toEqual([]);
    });

    it("REQ-1: treats a root with no owned field as user-owned", () => {
      const pluginPath = ensureUser();
      expect(isLink(join(pluginPath, "skills"))).toBe(false);
      expect(existsSync(join(pluginPath, "skills", "top.md"))).toBe(true);
    });

    it("REQ-1: leaves the user's source folder untouched", () => {
      ensureUser({ owned: "user" });
      expect(readFileSync(join(userSkills, "top.md"), "utf8")).toBe("top\n");
      expect(existsSync(join(userSkills, "demo", "SKILL.md"))).toBe(true);
      expect(existsSync(join(userSkills, MARKER))).toBe(false);
    });

    it("REQ-1: writes the marker file that identifies Zana's copy", () => {
      const pluginPath = ensureUser({ owned: "user" });
      expect(existsSync(join(pluginPath, "skills", MARKER))).toBe(true);
    });
  });

  describe("REQ-2 Zana-owned root is still linked", () => {
    it("REQ-2: links a zana-owned root exactly as before", () => {
      const pluginPath = ensureUser({ id: "global-skills:abc", owned: "zana" });
      const skills = join(pluginPath, "skills");
      expect(isLink(skills)).toBe(true);
      expect(readlinkSync(skills)).toBe(userSkills);
    });
  });

  describe("REQ-3 links inside the source are followed only as skill-plugins-links.test.ts allows", () => {
    it("REQ-3: copySkillTree with no link policy skips symlinks to files and folders and counts them", () => {
      symlinkSync(secret, join(userSkills, "escape"), "junction");
      symlinkSync(join(secret, "token.txt"), join(userSkills, "token-link.txt"));
      const destination = join(baseDir, "dest");

      const result = copySkillTree(userSkills, destination, LIMITS);

      expect(result.skipped).toBe(2);
      expect(result.files).toBe(2);
      expect(existsSync(join(destination, "escape"))).toBe(false);
      expect(existsSync(join(destination, "token-link.txt"))).toBe(false);
      expect(readFileSync(join(destination, "top.md"), "utf8")).toBe("top\n");
      expect(readFileSync(join(secret, "token.txt"), "utf8")).toBe(
        "do not copy\n",
      );
    });

    it("REQ-3: a link to a folder outside the home folder inside a user root leaks nothing into the plugin", () => {
      symlinkSync(secret, join(userSkills, "demo", "escape"), "junction");
      const pluginPath = ensureUser({ owned: "user" });
      const copied = listTree(join(pluginPath, "skills"));
      expect(copied.some((p) => p.endsWith("token.txt"))).toBe(false);
      expect(copied.filter(isLink)).toEqual([]);
    });

    it("REQ-3: copySkillTree reports copied file and byte counts", () => {
      const result = copySkillTree(userSkills, join(baseDir, "dest"), LIMITS);
      expect(result.files).toBe(2);
      expect(result.bytes).toBeGreaterThan(0);
      expect(result.skipped).toBe(0);
    });

    it.skipIf(process.platform === "win32")(
      "REQ-3: copied files get 0o600 and directories 0o700",
      () => {
        const destination = join(baseDir, "dest");
        copySkillTree(userSkills, destination, LIMITS);
        expect(statSync(join(destination, "top.md")).mode & 0o777).toBe(0o600);
        expect(statSync(join(destination, "demo")).mode & 0o777).toBe(0o700);
      },
    );
  });

  describe("REQ-4 limits", () => {
    it("REQ-4: a root over the file limit throws an error naming maxFiles", () => {
      expect(() =>
        copySkillTree(userSkills, join(baseDir, "d1"), {
          ...LIMITS,
          maxFiles: 1,
        }),
      ).toThrow(/maxFiles/u);
    });

    it("REQ-4: a root over the size limit throws an error naming maxBytes", () => {
      writeFileSync(join(userSkills, "big.bin"), Buffer.alloc(4096, 1));
      expect(() =>
        copySkillTree(userSkills, join(baseDir, "d2"), {
          ...LIMITS,
          maxBytes: 1024,
        }),
      ).toThrow(/maxBytes/u);
    });

    it("REQ-4: a root over the depth limit throws an error naming maxDepth", () => {
      const deep = join(userSkills, "a", "b", "c", "d");
      mkdirSync(deep, { recursive: true });
      writeFileSync(join(deep, "file.txt"), "deep\n");
      expect(() =>
        copySkillTree(userSkills, join(baseDir, "d3"), {
          ...LIMITS,
          maxDepth: 2,
        }),
      ).toThrow(/maxDepth/u);
    });

    it("REQ-4: a root exactly at the limits is copied", () => {
      const result = copySkillTree(userSkills, join(baseDir, "d4"), {
        maxDepth: 1,
        maxFiles: 2,
        maxBytes: 1024,
      });
      expect(result.files).toBe(2);
    });

    it("REQ-4: a limit hit on one root leaves the next root's plugin intact", () => {
      const other = join(baseDir, "other-skills");
      mkdirSync(other, { recursive: true });
      writeFileSync(join(other, "ok.md"), "ok\n");
      const tooBig = join(baseDir, "too-big");
      mkdirSync(tooBig, { recursive: true });
      for (let i = 0; i < 3; i += 1) {
        writeFileSync(join(tooBig, `f${i}.md`), "x\n");
      }
      // 3 files vs. the default 2,000 cap cannot trip; use a depth bomb instead.
      let deep = tooBig;
      for (let i = 0; i < 20; i += 1) deep = join(deep, `d${i}`);
      mkdirSync(deep, { recursive: true });
      writeFileSync(join(deep, "f.md"), "x\n");

      expect(() => ensureUser({ id: "native-claude-1", path: tooBig })).toThrow(
        /maxDepth/u,
      );
      const pluginPath = ensureUser({ id: "native-claude-2", path: other });
      expect(readFileSync(join(pluginPath, "skills", "ok.md"), "utf8")).toBe(
        "ok\n",
      );
    });
  });

  describe("REQ-5 atomic copy", () => {
    it.skipIf(!canChmod)(
      "REQ-5: an unreadable file midway throws and leaves no destination from copySkillTree callers' plugin",
      () => {
        const locked = join(userSkills, "demo", "locked.md");
        writeFileSync(locked, "secret\n");
        chmodSync(locked, 0o000);
        try {
          expect(() => ensureUser({ owned: "user" })).toThrow();
          const skills = join(
            pluginsRoot,
            createHash("sha256")
              .update(`native-claude-0\0${userSkills}`)
              .digest("hex")
              .slice(0, 16),
            "skills",
          );
          expect(existsSync(skills)).toBe(false);
          const entries = readdirSync(join(skills, ".."));
          expect(entries.filter((n) => n.startsWith(".tmp-"))).toEqual([]);
        } finally {
          chmodSync(locked, 0o600);
        }
      },
    );

    it.skipIf(!canChmod)(
      "REQ-5: a failed refresh keeps the previous valid copy and leaves no temp sibling",
      () => {
        const pluginPath = ensureUser({ owned: "user" });
        const skills = join(pluginPath, "skills");
        const locked = join(userSkills, "demo", "locked.md");
        writeFileSync(locked, "secret\n");
        chmodSync(locked, 0o000);
        try {
          expect(() => ensureUser({ owned: "user" })).toThrow();
          expect(readFileSync(join(skills, "top.md"), "utf8")).toBe("top\n");
          expect(existsSync(join(skills, "demo", "locked.md"))).toBe(false);
          expect(
            readdirSync(pluginPath).filter((n) => n.startsWith(".tmp-")),
          ).toEqual([]);
        } finally {
          chmodSync(locked, 0o600);
        }
      },
    );

    it.skipIf(!canChmod)(
      "REQ-5: copySkillTree throws on an unreadable file",
      () => {
        const locked = join(userSkills, "locked.md");
        writeFileSync(locked, "secret\n");
        chmodSync(locked, 0o000);
        try {
          expect(() =>
            copySkillTree(userSkills, join(baseDir, "dest"), LIMITS),
          ).toThrow();
        } finally {
          chmodSync(locked, 0o600);
        }
      },
    );

    it("REQ-5: a successful copy leaves no .tmp- sibling behind", () => {
      const pluginPath = ensureUser({ owned: "user" });
      expect(
        readdirSync(pluginPath).filter((n) => n.startsWith(".tmp-")),
      ).toEqual([]);
    });
  });

  describe("REQ-6 refresh", () => {
    it("REQ-6: a second call with an unchanged source does not recopy", () => {
      const pluginPath = ensureUser({ owned: "user" });
      expect(isLink(join(pluginPath, "skills"))).toBe(false);
      const sentinel = join(pluginPath, "skills", "sentinel.txt");
      writeFileSync(sentinel, "still here\n");
      ensureUser({ owned: "user" });
      expect(existsSync(sentinel)).toBe(true);
    });

    it("REQ-6: a new file in the source is picked up", () => {
      const pluginPath = ensureUser({ owned: "user" });
      expect(isLink(join(pluginPath, "skills"))).toBe(false);
      writeFileSync(join(userSkills, "added.md"), "added\n");
      ensureUser({ owned: "user" });
      expect(readFileSync(join(pluginPath, "skills", "added.md"), "utf8")).toBe(
        "added\n",
      );
    });

    it("REQ-6: a changed file size is picked up", () => {
      const pluginPath = ensureUser({ owned: "user" });
      expect(isLink(join(pluginPath, "skills"))).toBe(false);
      writeFileSync(join(userSkills, "top.md"), "top and much longer now\n");
      ensureUser({ owned: "user" });
      expect(readFileSync(join(pluginPath, "skills", "top.md"), "utf8")).toBe(
        "top and much longer now\n",
      );
    });

    it("REQ-6: a missing destination is recopied", () => {
      const pluginPath = ensureUser({ owned: "user" });
      expect(isLink(join(pluginPath, "skills"))).toBe(false);
      rmSync(join(pluginPath, "skills"), { recursive: true });
      ensureUser({ owned: "user" });
      expect(existsSync(join(pluginPath, "skills", "top.md"))).toBe(true);
    });
  });

  describe("REQ-7 migration and refusal", () => {
    it("REQ-7: replaces an old link at skills with the copy and keeps the target's files", () => {
      const pluginPath = ensureUser({ owned: "zana" });
      const skills = join(pluginPath, "skills");
      expect(isLink(skills)).toBe(true);

      ensureUser({ owned: "user" });

      expect(isLink(skills)).toBe(false);
      expect(existsSync(join(skills, "top.md"))).toBe(true);
      expect(readFileSync(join(userSkills, "top.md"), "utf8")).toBe("top\n");
      expect(existsSync(join(userSkills, "demo", "SKILL.md"))).toBe(true);
    });

    it("REQ-7: a real directory without the marker is refused and left intact", () => {
      const pluginPath = ensureUser({ owned: "user" });
      const skills = join(pluginPath, "skills");
      rmSync(skills, { recursive: true });
      mkdirSync(join(skills, "mine"), { recursive: true });
      writeFileSync(join(skills, "mine", "SKILL.md"), "keep me\n");

      expect(() => ensureUser({ owned: "user" })).toThrow(
        "refusing to replace a real directory",
      );
      expect(readFileSync(join(skills, "mine", "SKILL.md"), "utf8")).toBe(
        "keep me\n",
      );
    });

    it("REQ-7: a real directory with the marker is replaced by a fresh copy", () => {
      const pluginPath = ensureUser({ owned: "user" });
      const skills = join(pluginPath, "skills");
      writeFileSync(join(userSkills, "later.md"), "later\n");
      writeFileSync(join(skills, "stale.md"), "stale\n");
      expect(existsSync(join(skills, MARKER))).toBe(true);

      ensureUser({ owned: "user" });

      expect(existsSync(join(skills, "stale.md"))).toBe(false);
      expect(existsSync(join(skills, "later.md"))).toBe(true);
    });

    it("REQ-7: a plain file at skills is replaced by the copy", () => {
      const pluginPath = ensureUser({ owned: "user" });
      const skills = join(pluginPath, "skills");
      rmSync(skills, { recursive: true });
      writeFileSync(skills, "stale\n");
      ensureUser({ owned: "user" });
      expect(lstatSync(skills).isDirectory()).toBe(true);
      expect(existsSync(join(skills, "top.md"))).toBe(true);
    });
  });

  describe("REQ-8 nothing in the temp dir links to the user's folder", () => {
    it("REQ-8: removing the plugins root leaves the user's folder untouched", () => {
      ensureUser({ owned: "user" });
      expect(listTree(pluginsRoot).filter(isLink)).toEqual([]);
      rmSync(pluginsRoot, { recursive: true, force: true });
      expect(readFileSync(join(userSkills, "top.md"), "utf8")).toBe("top\n");
      expect(existsSync(join(userSkills, "demo", "SKILL.md"))).toBe(true);
    });

    it("REQ-8: a commands-style root and a plugin skills root are copied too", () => {
      const commands = join(baseDir, "home", ".claude", "commands");
      mkdirSync(commands, { recursive: true });
      writeFileSync(join(commands, "go.md"), "go\n");
      const pluginSkills = join(baseDir, "plug", "skills");
      mkdirSync(pluginSkills, { recursive: true });
      writeFileSync(join(pluginSkills, "s.md"), "s\n");
      const taken = new Map<string, string>();
      ensureUser({ id: "native-claude-1", path: commands }, taken);
      ensureUser({ id: "native-claude-2", path: pluginSkills }, taken);
      expect(listTree(pluginsRoot).filter(isLink)).toEqual([]);
    });
  });

  describe("REQ-9 manifest, name and path unchanged", () => {
    function manifestOf(pluginPath: string): Record<string, unknown> {
      return JSON.parse(
        readFileSync(join(pluginPath, ".claude-plugin", "plugin.json"), "utf8"),
      ) as Record<string, unknown>;
    }

    it("REQ-9: a user root gets the same manifest, directory name and skills entry as before", () => {
      const pluginPath = ensureUser({ owned: "user" });
      const hash = createHash("sha256")
        .update(`native-claude-0\0${userSkills}`)
        .digest("hex")
        .slice(0, 16);
      expect(pluginPath).toBe(join(pluginsRoot, hash));
      const manifest = manifestOf(pluginPath);
      expect(manifest.name).toBe(CLAUDE_SKILL_PLUGIN_NAME);
      expect(manifest.skills).toBe("./skills");
      expect(manifest.description).toBe(
        "Skills injected by ZCC (native-claude-0).",
      );
      expect(isLink(join(pluginPath, "skills"))).toBe(false);
    });

    it("REQ-9: a user root and a zana root with the same id and path share one plugin directory and manifest", () => {
      const other = createClaudeSkillPluginsRoot(baseDir);
      const asUser = ensureUser({ owned: "user" });
      const asZana = ensureClaudeSkillPlugin({
        pluginsRoot: other,
        root: { id: "native-claude-0", path: userSkills, owned: "zana" },
      });
      expect(asUser.slice(pluginsRoot.length)).toBe(asZana.slice(other.length));
      expect(manifestOf(asUser)).toEqual(manifestOf(asZana));
    });

    it("REQ-9: a second user root suffixes its plugin name and keeps the first stable", () => {
      const second = join(baseDir, "second");
      mkdirSync(second, { recursive: true });
      writeFileSync(join(second, "x.md"), "x\n");
      const taken = new Map<string, string>();
      const a = ensureUser({ id: "native-claude-0" }, taken);
      const b = ensureUser({ id: "native-claude-1", path: second }, taken);
      expect(manifestOf(a).name).toBe(CLAUDE_SKILL_PLUGIN_NAME);
      expect(manifestOf(b).name).toMatch(/^zcc-global-skills-[0-9a-f]{8}$/u);
      expect(isLink(join(b, "skills"))).toBe(false);
    });
  });

  describe("correctness obligations (OBL-001..007)", () => {
    it("OBL-001: a root exactly at the byte and depth limits is copied", () => {
      const deep = join(userSkills, "a", "b");
      mkdirSync(deep, { recursive: true });
      writeFileSync(join(deep, "f.txt"), "12345");
      const sizes = listTree(userSkills)
        .filter((p) => lstatSync(p).isFile())
        .reduce((n, p) => n + lstatSync(p).size, 0);
      const result = copySkillTree(userSkills, join(baseDir, "exact"), {
        maxDepth: 3,
        maxFiles: 3,
        maxBytes: sizes,
      });
      expect(result.files).toBe(3);
      expect(result.bytes).toBe(sizes);
      expect(() =>
        copySkillTree(userSkills, join(baseDir, "over"), {
          maxDepth: 3,
          maxFiles: 3,
          maxBytes: sizes - 1,
        }),
      ).toThrow(/maxBytes/u);
      expect(existsSync(join(baseDir, "over"))).toBe(false);
    });

    it("OBL-001: a limit failure leaves no skills directory and no .tmp- sibling", () => {
      let deep = join(userSkills, "x");
      for (let i = 0; i < 20; i += 1) deep = join(deep, `d${i}`);
      mkdirSync(deep, { recursive: true });
      const hash = createHash("sha256")
        .update(`native-claude-0\0${userSkills}`)
        .digest("hex")
        .slice(0, 16);
      expect(() => ensureUser()).toThrow(/maxDepth/u);
      const pluginPath = join(pluginsRoot, hash);
      expect(existsSync(join(pluginPath, "skills"))).toBe(false);
      expect(
        readdirSync(pluginPath).filter((n) => n.startsWith(".tmp-")),
      ).toEqual([]);
    });

    it.skipIf(process.platform === "win32")(
      "OBL-002: the plugin copy has 0o600 files, 0o700 directories and a 0o600 marker",
      () => {
        const skills = join(ensureUser(), "skills");
        expect(statSync(join(skills, "top.md")).mode & 0o777).toBe(0o600);
        expect(statSync(join(skills, "demo")).mode & 0o777).toBe(0o700);
        expect(statSync(join(skills, MARKER)).mode & 0o777).toBe(0o600);
      },
    );

    it.skipIf(process.platform === "win32")(
      "OBL-002: a FIFO in the source is skipped and counted, not read",
      () => {
        execFileSync("mkfifo", [join(userSkills, "pipe")]);
        const result = copySkillTree(userSkills, join(baseDir, "fifo"), LIMITS);
        expect(result.skipped).toBe(1);
        expect(existsSync(join(baseDir, "fifo", "pipe"))).toBe(false);
      },
    );

    it("OBL-005: adding a link to the source triggers a recopy that still skips it", () => {
      const pluginPath = ensureUser();
      symlinkSync(secret, join(userSkills, "late-link"), "junction");
      ensureUser();
      expect(existsSync(join(pluginPath, "skills", "late-link"))).toBe(false);
      expect(
        readFileSync(join(pluginPath, "skills", MARKER), "utf8").split("\0")[4],
      ).toBe("1");
    });

    it("OBL-005: a changed file mtime with the same size is picked up", () => {
      const pluginPath = ensureUser();
      writeFileSync(join(userSkills, "top.md"), "tap\n");
      utimesSync(join(userSkills, "top.md"), new Date(), new Date(Date.now() + 5000));
      ensureUser();
      expect(readFileSync(join(pluginPath, "skills", "top.md"), "utf8")).toBe(
        "tap\n",
      );
    });

    it("OBL-007: the marker holds the fingerprint and the migrated copy leaves the old target intact", () => {
      const pluginPath = ensureUser({ owned: "zana" });
      ensureUser();
      const marker = readFileSync(join(pluginPath, "skills", MARKER), "utf8");
      expect(marker.startsWith(userSkills)).toBe(true);
      expect(readdirSync(userSkills).sort()).toEqual(["demo", "top.md"]);
    });
  });
});
