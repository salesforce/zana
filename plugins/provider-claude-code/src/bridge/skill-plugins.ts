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
  opendirSync,
  readSync,
  readdirSync,
  realpathSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

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
  /** Shared across the roots of one configure; user roots draw on it (#587). */
  budget?: SkillCopyBudget;
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
  writeManifestIfChanged(
    join(pluginPath, ".claude-plugin", "plugin.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const skillsLink = join(pluginPath, "skills");
  if ((args.root.owned ?? "user") === "user") {
    refreshSkillCopy(pluginPath, skillsLink, args.root.path, args.budget);
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

/** Rewrite only when the content differs: readers may have it open. */
function writeManifestIfChanged(path: string, content: string): void {
  try {
    if (readFileSync(path, "utf8") === content) return;
  } catch {
    // Missing or unreadable: write it below.
  }
  writeFileSync(path, content, "utf8");
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

/** What all user roots of one configure may use together, and by when. */
export interface SkillCopyBudget {
  deadlineMs: number;
  files: number;
  bytes: number;
}

const BUDGET_DEADLINE_MS = 20_000;
const BUDGET_FILES = 10_000;
const BUDGET_BYTES = 64 * 1024 * 1024;

export function createSkillCopyBudget(now = Date.now()): SkillCopyBudget {
  return {
    deadlineMs: now + BUDGET_DEADLINE_MS,
    files: BUDGET_FILES,
    bytes: BUDGET_BYTES,
  };
}

/** Directories, links and files together may number this many times maxFiles. */
const ENTRY_CAP_FACTOR = 4;

const COPY_MARKER = ".zcc-skill-copy";

interface TreeScan {
  dirs: string[];
  files: { rel: string; size: number; exec: boolean }[];
  skipped: number;
  bytes: number;
  /** One line per entry (path, kind, size, mtime): the refresh fingerprint. */
  entries: string[];
}

function scanTree(source: string, limits: CopySkillTreeLimits): TreeScan {
  const scan: TreeScan = { dirs: [], files: [], skipped: 0, bytes: 0, entries: [] };
  const realRoot = realpathSync.native(source);
  let seen = 0;
  const walk = (relDir: string, depth: number): void => {
    for (const name of listNames(join(source, relDir), () => seen, limits)) {
      // Every entry counts, so many empty dirs or links cannot dodge a cap.
      seen += 1;
      if (seen > limits.maxFiles * ENTRY_CAP_FACTOR) {
        throw new Error(`skill root exceeds maxEntries (${limits.maxFiles * ENTRY_CAP_FACTOR})`);
      }
      const rel = relDir === "" ? name : join(relDir, name);
      const stat = lstatSync(join(source, rel));
      if (stat.isSymbolicLink()) {
        scan.skipped += 1;
        scan.entries.push(`${rel}\0l`);
      } else if (stat.isDirectory()) {
        // A Windows junction can be reported as a plain directory: only enter
        // it when its real path is the path walked to.
        if (!sameRealPath(join(source, rel), join(realRoot, rel))) {
          scan.skipped += 1;
          scan.entries.push(`${rel}\0l`);
          continue;
        }
        if (depth + 1 > limits.maxDepth) {
          throw new Error(`skill root exceeds maxDepth (${limits.maxDepth})`);
        }
        scan.dirs.push(rel);
        scan.entries.push(`${rel}\0d\0${stat.mtimeMs}`);
        walk(rel, depth + 1);
      } else if (stat.isFile()) {
        if (scan.files.length + 1 > limits.maxFiles) {
          throw new Error(`skill root exceeds maxFiles (${limits.maxFiles})`);
        }
        scan.bytes += stat.size;
        if (scan.bytes > limits.maxBytes) {
          throw new Error(`skill root exceeds maxBytes (${limits.maxBytes})`);
        }
        scan.files.push({ rel, size: stat.size, exec: (stat.mode & 0o100) !== 0 });
        scan.entries.push(`${rel}\0f\0${stat.size}\0${stat.mtimeMs}\0${stat.mode & 0o100}`);
      } else {
        scan.skipped += 1;
        scan.entries.push(`${rel}\0o`);
      }
    }
  };
  scan.entries.push(`.\0d\0${lstatSync(source).mtimeMs}`);
  walk("", 0);
  scan.entries.sort();
  return scan;
}

/** Directory entries, stopping once the entry cap would be passed. */
function listNames(
  dir: string,
  seenSoFar: () => number,
  limits: CopySkillTreeLimits,
): string[] {
  const cap = limits.maxFiles * ENTRY_CAP_FACTOR;
  const names: string[] = [];
  const handle = opendirSync(dir);
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      names.push(entry.name);
      if (seenSoFar() + names.length > cap) {
        throw new Error(`skill root exceeds maxEntries (${cap})`);
      }
    }
  } finally {
    handle.closeSync();
  }
  return names;
}

function sameRealPath(path: string, expected: string): boolean {
  try {
    const real = realpathSync.native(path);
    return process.platform === "win32"
      ? real.toLowerCase() === expected.toLowerCase()
      : real === expected;
  } catch {
    return false;
  }
}

function fingerprintOf(sourcePath: string, scan: TreeScan): string {
  const digest = createHash("sha256")
    .update(scan.entries.join("\n"))
    .digest("hex");
  return [
    sourcePath,
    scan.files.length,
    scan.bytes,
    scan.dirs.length,
    scan.skipped,
    digest,
  ].join("\0");
}

/** Read a file the scan saw, never more than its scanned size. */
function readRegularFile(path: string, size: number): Buffer {
  // O_NOFOLLOW (absent on Windows) refuses a link swapped in after the scan.
  const fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error("not a regular file");
    const buffer = Buffer.alloc(size + 1);
    let read = 0;
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, null);
      if (n === 0) break;
      read += n;
    }
    if (read > size) throw new Error("skill file grew while it was copied");
    return buffer.subarray(0, read);
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
  const realSource = realpathSync.native(source);
  for (const rel of scan.dirs) {
    mkdirSync(join(destination, rel), { mode: 0o700 });
  }
  let bytes = 0;
  for (const file of scan.files) {
    // The scan and this read resolve paths separately: re-check the parent
    // right before every open, which leaves only the open itself unchecked.
    const parent = file.rel.includes(sep) ? file.rel.slice(0, file.rel.lastIndexOf(sep)) : "";
    if (!sameRealPath(join(source, parent), join(realSource, parent))) {
      throw new Error("skill folder changed while it was copied");
    }
    const data = readRegularFile(join(source, file.rel), file.size);
    bytes += data.length;
    if (bytes > limits.maxBytes) {
      throw new Error(`skill root exceeds maxBytes (${limits.maxBytes})`);
    }
    writeFileSync(join(destination, file.rel), data, {
      mode: file.exec ? 0o700 : 0o600,
    });
  }
  return { files: scan.files.length, bytes, skipped: scan.skipped };
}

/**
 * Copy the regular files of `source` into a new `destination` without
 * following any link inside the source. Links and other non-regular entries
 * are skipped and counted. Throws when a limit is exceeded, a file cannot be
 * read, or `destination` already exists; it removes the partial `destination`
 * it created and never an existing one.
 */
export function copySkillTree(
  source: string,
  destination: string,
  limits: CopySkillTreeLimits,
): CopySkillTreeResult {
  return copyScannedInto(source, destination, scanTree(source, limits), limits);
}

function copyScannedInto(
  source: string,
  destination: string,
  scan: TreeScan,
  limits: CopySkillTreeLimits,
): CopySkillTreeResult {
  if (lstatOrNull(destination) !== null) {
    throw new Error(`copy destination already exists: ${destination}`);
  }
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
  budget?: SkillCopyBudget,
): void {
  if (budget !== undefined && Date.now() > budget.deadlineMs) {
    throw new Error("total budget: time limit for skill copies reached");
  }
  const scan = scanTree(sourcePath, SKILL_COPY_LIMITS);
  if (budget !== undefined) {
    budget.files -= scan.files.length;
    budget.bytes -= scan.bytes;
    if (budget.files < 0 || budget.bytes < 0) {
      throw new Error("total budget: file or size limit across skill roots reached");
    }
  }
  const fingerprint = fingerprintOf(sourcePath, scan);
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
  const suffix = randomBytes(6).toString("hex");
  const temp = join(pluginPath, `.tmp-${suffix}`);
  copyScannedInto(sourcePath, temp, scan, SKILL_COPY_LIMITS);
  try {
    writeFileSync(join(temp, COPY_MARKER), fingerprint, {
      encoding: "utf8",
      mode: 0o600,
    });
    publishCopy(temp, skills, join(pluginPath, `.old-${suffix}`), hasOldCopy);
  } catch (error) {
    removeCopiedTree(temp);
    throw error;
  }
}

/**
 * Put the staged copy at `skills` without a window where `skills` is missing
 * or half removed: move the old copy aside, rename the new one in, and put the
 * old one back if that fails. On failure `temp` is left for the caller.
 */
function publishCopy(
  temp: string,
  skills: string,
  aside: string,
  hasOldCopy: boolean,
): void {
  if (hasOldCopy) renameSync(skills, aside);
  try {
    renameSync(temp, skills);
  } catch (error) {
    if (hasOldCopy) renameSync(aside, skills);
    throw error;
  }
  if (hasOldCopy) {
    try {
      removeCopiedTree(aside);
    } catch (error) {
      process.stderr.write(
        `claude bridge: could not remove a replaced skill copy: ${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
}

function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}
