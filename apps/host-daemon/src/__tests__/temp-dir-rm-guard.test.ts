import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// REQ-12 (#552): recursive deletes in host-daemon and the bridge protocol
// package either use the link-safe remove or are named here with the reason
// they are safe to leave. A new recursive `rm` fails this test until someone
// decides which it is.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..", "..");
const ROOTS = [
  join(REPO, "apps", "host-daemon", "src"),
  join(REPO, "packages", "provider-bridge-protocol", "src"),
];

/**
 * `file` is relative to the repo root with forward slashes. `count` is how many
 * recursive rm calls that file may keep. The reason is the review record.
 */
const ALLOW_LIST: readonly { file: string; count: number; reason: string }[] = [
  {
    file: "apps/host-daemon/src/packed-native-pty.ts",
    count: 1,
    reason: "directory holds only extracted native files this process wrote",
  },
  {
    file: "apps/host-daemon/src/peer-tunnels.ts",
    count: 2,
    reason: "private key and socket scratch dir the tunnel wrote itself",
  },
  {
    file: "apps/host-daemon/src/codex-auth-native.ts",
    count: 1,
    reason: "scratch dir holding one auth file the call wrote itself",
  },
  {
    file: "packages/provider-bridge-protocol/src/testing/parity.ts",
    count: 2,
    reason: "test helper removing its own fixture directories",
  },
];

const RECURSIVE_RM = /\b(?:rm|rmSync)\s*\(/g;

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Count `rm(` / `rmSync(` calls whose argument list says `recursive: true`. */
function recursiveRmCount(text: string): number {
  const source = stripComments(text);
  let count = 0;
  for (const match of source.matchAll(RECURSIVE_RM)) {
    const start = (match.index ?? 0) + match[0].length;
    let depth = 1;
    let end = start;
    while (end < source.length && depth > 0) {
      const ch = source[end];
      if (ch === "(") depth += 1;
      else if (ch === ")") depth -= 1;
      end += 1;
    }
    if (/recursive\s*:\s*true/.test(source.slice(start, end))) count += 1;
  }
  return count;
}

function scan(): Map<string, number> {
  const files: string[] = [];
  for (const root of ROOTS) walk(root, files);
  const found = new Map<string, number>();
  for (const file of files) {
    const count = recursiveRmCount(readFileSync(file, "utf8"));
    if (count > 0) found.set(relative(REPO, file).split(sep).join("/"), count);
  }
  return found;
}

describe("recursive rm guard (REQ-12)", () => {
  it("REQ-12 every recursive rm is on the allow-list with its reason", () => {
    const allowed = new Map(ALLOW_LIST.map((e) => [e.file, e.count]));
    const unlisted = [...scan()]
      .filter(([file, count]) => count > (allowed.get(file) ?? 0))
      .map(([file, count]) => `${file}: ${count} recursive rm call(s)`);
    expect(unlisted).toEqual([]);
  });

  it("REQ-12 the allow-list has no stale entries", () => {
    const found = scan();
    const stale = ALLOW_LIST.filter(
      (entry) => (found.get(entry.file) ?? 0) < entry.count,
    ).map((entry) => entry.file);
    expect(stale).toEqual([]);
  });

  it("REQ-12 every allow-list entry gives a reason", () => {
    for (const entry of ALLOW_LIST) {
      expect(entry.reason.trim().length).toBeGreaterThan(10);
    }
  });

  it("REQ-12 the counter sees both rm and rmSync with recursive: true", () => {
    expect(recursiveRmCount("await rm(a, { recursive: true, force: true });")).toBe(1);
    expect(recursiveRmCount("rmSync(a, { force: true, recursive: true });")).toBe(1);
    expect(recursiveRmCount("rm(a, { force: true }); // rm(b, { recursive: true })")).toBe(0);
    expect(recursiveRmCount("fs.rm(join(a, f(b)), { recursive: true })")).toBe(1);
  });
});

describe("orphan sweep wiring (REQ-11)", () => {
  function productionFiles(): { file: string; text: string }[] {
    const files: string[] = [];
    walk(join(REPO, "apps", "host-daemon", "src"), files);
    return files.map((file) => ({
      file: relative(REPO, file).split(sep).join("/"),
      text: stripComments(readFileSync(file, "utf8")),
    }));
  }

  it("REQ-11 the daemon starts the sweep for bridge and host worker temp dirs", () => {
    const callers = productionFiles().filter(({ text }) =>
      /\bsweepOrphanTempDirs\s*\(/.test(text),
    );
    expect(callers.length).toBeGreaterThan(0);
    for (const { text } of callers) {
      expect(text).toMatch(/bb-provider-bridge/);
      expect(text).toMatch(/zcc-host/);
    }
  });

  it("REQ-11 the daemon never awaits the sweep, so it cannot delay start", () => {
    for (const { file, text } of productionFiles()) {
      expect(text, file).not.toMatch(/await\s+(?:\w+\.)?sweepOrphanTempDirs\s*\(/);
    }
  });
});

