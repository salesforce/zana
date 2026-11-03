import { experimental_removeUnlessRealDirectory } from "@zana-ai/zcc-plugin-sdk/provider-bridge";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ClaudeSkillPluginRoot {
  id: string;
  path: string;
  /**
   * Who owns the folder at `path`. `"zana"` roots (Zana's own snapshots) may be
   * linked; `"user"` roots are copied, never linked. Absent means `"user"`.
   */
  owned?: "zana" | "user";
}

/** Caps for one `copySkillTree` call. */
export interface CopySkillTreeLimits {
  maxDepth: number;
  maxFiles: number;
  maxBytes: number;
}

/** What `copySkillTree` copied and what it left out. */
export interface CopySkillTreeResult {
  files: number;
  bytes: number;
  /** Symlinks, junctions and other non-regular entries that were skipped. */
  skipped: number;
}

interface ClaudePluginManifest {
  $schema: string;
  name: string;
  version: string;
  description: string;
  author: { name: string };
  skills: string;
}

const MANIFEST_SCHEMA = "https://anthropic.com/claude-code/plugin.schema.json";

function pluginDirectoryName(root: ClaudeSkillPluginRoot): string {
  return createHash("sha256")
    .update(`${root.id}\0${root.path}`)
    .digest("hex")
    .slice(0, 16);
}

export const CLAUDE_SKILL_PLUGIN_NAME = "zcc-global-skills";

function pluginNameFor(
  root: ClaudeSkillPluginRoot,
  takenBy: ReadonlyMap<string, string>,
): string {
  const directory = pluginDirectoryName(root);
  const owner = takenBy.get(CLAUDE_SKILL_PLUGIN_NAME);
  if (owner === undefined || owner === directory) {
    return CLAUDE_SKILL_PLUGIN_NAME;
  }
  return `${CLAUDE_SKILL_PLUGIN_NAME}-${directory.slice(0, 8)}`;
}

export function ensureClaudeSkillPlugin(args: {
  pluginsRoot: string;
  root: ClaudeSkillPluginRoot;
  takenNames?: Map<string, string>;
}): string {
  const directory = pluginDirectoryName(args.root);
  const pluginPath = join(args.pluginsRoot, directory);
  const takenNames = args.takenNames ?? new Map<string, string>();
  const name = pluginNameFor(args.root, takenNames);
  takenNames.set(name, directory);
  mkdirSync(join(pluginPath, ".claude-plugin"), { recursive: true });
  const manifest: ClaudePluginManifest = {
    $schema: MANIFEST_SCHEMA,
    name,
    version: "0.1.0",
    description: `Skills injected by ZCC (${args.root.id}).`,
    author: { name: "zcc" },
    skills: "./skills",
  };
  writeFileSync(
    join(pluginPath, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  const skillsLink = join(pluginPath, "skills");
  if ((args.root.owned ?? "user") === "user") {
    refreshSkillCopy(pluginPath, skillsLink, args.root.path);
    return pluginPath;
  }
  let current: string | null = null;
  try {
    current = lstatSync(skillsLink).isSymbolicLink()
      ? readlinkSync(skillsLink)
      : "";
  } catch {
    current = null;
  }
  if (current !== args.root.path) {
    removeSkillsLink(skillsLink);
    // A junction needs no Developer Mode or admin rights on Windows, where a
    // "dir" symlink fails with EPERM; other platforms ignore the type.
    symlinkSync(args.root.path, skillsLink, "junction");
  }
  return pluginPath;
}

/**
 * Remove the `skills` link before re-pointing it, as a link only. Never a
 * recursive delete: on Windows the link is a junction into a real user folder
 * (`~/.claude/skills`), and Electron's `rmSync` walks a junction as a plain
 * directory and empties it. A real directory here is not ours, so refuse it.
 */
function removeSkillsLink(skillsLink: string): void {
  if (!experimental_removeUnlessRealDirectory(skillsLink)) {
    throw new Error(`refusing to replace a real directory at ${skillsLink}`);
  }
}

export function createClaudeSkillPluginsRoot(baseDir = tmpdir()): string {
  mkdirSync(baseDir, { recursive: true });
  return mkdtempSync(join(baseDir, "zcc-claude-skill-plugins-"));
}

/** Per-root caps for the copy (#587). */
export const SKILL_COPY_LIMITS: CopySkillTreeLimits = {
  maxDepth: 16,
  maxFiles: 2000,
  maxBytes: 16 * 1024 * 1024,
};

const COPY_MARKER = ".zcc-skill-copy";

interface TreeScan {
  dirs: string[];
  files: { rel: string; size: number }[];
  skipped: number;
  bytes: number;
  newestMtimeMs: number;
}

function scanTree(source: string, limits: CopySkillTreeLimits): TreeScan {
  const scan: TreeScan = {
    dirs: [],
    files: [],
    skipped: 0,
    bytes: 0,
    newestMtimeMs: 0,
  };
  const walk = (relDir: string, depth: number): void => {
    for (const name of readdirSync(join(source, relDir))) {
      const rel = relDir === "" ? name : join(relDir, name);
      const stat = lstatSync(join(source, rel));
      scan.newestMtimeMs = Math.max(scan.newestMtimeMs, stat.mtimeMs);
      if (stat.isSymbolicLink()) {
        scan.skipped += 1;
      } else if (stat.isDirectory()) {
        if (depth + 1 > limits.maxDepth) {
          throw new Error(`skill root exceeds maxDepth (${limits.maxDepth})`);
        }
        scan.dirs.push(rel);
        walk(rel, depth + 1);
      } else if (stat.isFile()) {
        if (scan.files.length + 1 > limits.maxFiles) {
          throw new Error(`skill root exceeds maxFiles (${limits.maxFiles})`);
        }
        scan.bytes += stat.size;
        if (scan.bytes > limits.maxBytes) {
          throw new Error(`skill root exceeds maxBytes (${limits.maxBytes})`);
        }
        scan.files.push({ rel, size: stat.size });
      } else {
        scan.skipped += 1;
      }
    }
  };
  walk("", 0);
  return scan;
}

function readRegularFile(path: string): Buffer {
  // O_NOFOLLOW (absent on Windows) refuses a link swapped in after the scan.
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error("not a regular file");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

function copyScanned(
  source: string,
  destination: string,
  scan: TreeScan,
  limits: CopySkillTreeLimits,
): CopySkillTreeResult {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const rel of scan.dirs) {
    mkdirSync(join(destination, rel), { mode: 0o700 });
  }
  let bytes = 0;
  for (const file of scan.files) {
    const data = readRegularFile(join(source, file.rel));
    bytes += data.length;
    if (bytes > limits.maxBytes) {
      throw new Error(`skill root exceeds maxBytes (${limits.maxBytes})`);
    }
    writeFileSync(join(destination, file.rel), data, { mode: 0o600 });
  }
  return { files: scan.files.length, bytes, skipped: scan.skipped };
}

/**
 * Copy the regular files of `source` into `destination` without following any
 * link inside the source. Links and other non-regular entries are skipped and
 * counted. Throws when a limit is exceeded or a file cannot be read, removing
 * the partial `destination` it created.
 */
export function copySkillTree(
  source: string,
  destination: string,
  limits: CopySkillTreeLimits,
): CopySkillTreeResult {
  const scan = scanTree(source, limits);
  try {
    return copyScanned(source, destination, scan, limits);
  } catch (error) {
    removeCopiedTree(destination);
    throw error;
  }
}

/**
 * Remove a directory tree this module wrote. Every entry goes through the
 * link-safe single-entry remove, so a link is unlinked, never walked.
 */
function removeCopiedTree(path: string): void {
  if (experimental_removeUnlessRealDirectory(path)) return;
  for (const name of readdirSync(path)) removeCopiedTree(join(path, name));
  rmdirSync(path);
}

function refreshSkillCopy(
  pluginPath: string,
  skills: string,
  sourcePath: string,
): void {
  const scan = scanTree(sourcePath, SKILL_COPY_LIMITS);
  const fingerprint = [
    sourcePath,
    scan.files.length,
    scan.bytes,
    scan.dirs.length,
    scan.skipped,
    scan.newestMtimeMs,
  ].join("\0");
  let hasOldCopy = false;
  if (lstatOrNull(skills) !== null) {
    // Removes an old link (or stray file) as a link; false means a real dir.
    if (!experimental_removeUnlessRealDirectory(skills)) {
      let marker: string;
      try {
        marker = readFileSync(join(skills, COPY_MARKER), "utf8");
      } catch {
        throw new Error(`refusing to replace a real directory at ${skills}`);
      }
      if (marker === fingerprint) return;
      hasOldCopy = true;
    }
  }
  const temp = join(pluginPath, `.tmp-${randomBytes(6).toString("hex")}`);
  try {
    copyScanned(sourcePath, temp, scan, SKILL_COPY_LIMITS);
    writeFileSync(join(temp, COPY_MARKER), fingerprint, {
      encoding: "utf8",
      mode: 0o600,
    });
  } catch (error) {
    removeCopiedTree(temp);
    throw error;
  }
  if (hasOldCopy) removeCopiedTree(skills);
  renameSync(temp, skills);
}

function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
