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
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";

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
  /** Which links inside a user root may be followed; defaults to links under the home folder. */
  linkPolicy?: SkillLinkPolicy;
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
    refreshSkillCopy(pluginPath, skillsLink, args.root.path, args.budget, args.linkPolicy);
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

/**
 * Per-root caps for the copy (#587). The byte cap is sized for real setups: one
 * owner's `~/.claude/skills` is about 20 MB once its links are followed (a
 * single skill with bundled media is 17 MB), so 16 MiB would drop every skill
 * of that root. It stays under the 64 MiB budget shared by all roots of one
 * configure.
 */
export const SKILL_COPY_LIMITS: CopySkillTreeLimits = {
  maxDepth: 16,
  maxFiles: 2000,
  maxBytes: 48 * 1024 * 1024,
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

/**
 * What a user skills folder copy may follow and must never copy (#587).
 *
 * A link is followed (its target copied as real files, never as a link) only
 * when its real target is under `home`, is not denied, and is either under one
 * of `allowUnder` (known skill install locations) or has a path segment named
 * in `allowSegments` (a skills library kept elsewhere, such as
 * `~/work/Skills/<name>`). Absent `home` means no link is followed.
 *
 * `deny*` applies to EVERY path the copy touches: link targets and each file
 * and directory below them, and ordinary entries too. A denied entry is
 * skipped and counted, so a link to `~/.config` cannot pull in
 * `~/.config/gcloud`.
 */
export interface SkillLinkPolicy {
  home?: string;
  allowUnder?: readonly string[];
  allowSegments?: readonly string[];
  /** Absolute folders or files; anything at or below one is denied. */
  denyUnder?: readonly string[];
  /** A path segment with one of these names (compared lower case) is denied. */
  denySegments?: readonly string[];
  /** A file or folder with one of these names (lower case) is denied anywhere. */
  denyNames?: readonly string[];
}

/** Home-relative skill install locations a link may point into. */
const ALLOWED_INSTALL_LOCATIONS = [
  ".claude/skills",
  ".claude/commands",
  ".claude/agents",
  ".claude/plugins",
  ".agents",
  ".cursor/skills",
  ".cursor/skills-cursor",
  ".cursor/commands",
  ".cursor/plugins",
  ".codex/skills",
  ".codex/prompts",
];

/** A path segment like this marks a skills library kept outside the dot folders. */
const ALLOWED_SEGMENTS = ["skills", "commands"];

/** Home-relative credential and settings locations, denied with everything below. */
const DENIED_LOCATIONS = [
  ".ssh",
  ".aws",
  ".gnupg",
  ".kube",
  ".docker",
  ".azure",
  ".config/gcloud",
  ".config/gh",
  "Library/Keychains",
  ".claude.json",
  ".claude/.credentials.json",
  ".claude/settings.json",
  ".claude/settings.local.json",
  ".netrc",
  ".npmrc",
  ".git-credentials",
];

const DENIED_SEGMENTS = [".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure"];
const DENIED_NAMES = [".credentials.json", ".netrc", ".npmrc", ".git-credentials"];

/** The policy for the user's real skill folders. */
export function defaultSkillLinkPolicy(home = homedir()): SkillLinkPolicy {
  return {
    home,
    allowUnder: ALLOWED_INSTALL_LOCATIONS.map((folder) => join(home, folder)),
    allowSegments: ALLOWED_SEGMENTS,
    denyUnder: DENIED_LOCATIONS.map((folder) => join(home, folder)),
    denySegments: DENIED_SEGMENTS,
    denyNames: DENIED_NAMES,
  };
}

/** The policy with every folder resolved to its real path, once per scan. */
interface ResolvedPolicy {
  home?: string;
  allowUnder: string[];
  allowSegments: string[];
  denyUnder: string[];
  denySegments: string[];
  denyNames: string[];
}

function resolvePolicy(policy: SkillLinkPolicy): ResolvedPolicy {
  return {
    ...(policy.home === undefined ? {} : { home: realPathOrSelf(policy.home) }),
    allowUnder: (policy.allowUnder ?? []).map(realPathOrSelf),
    allowSegments: (policy.allowSegments ?? []).map((n) => n.toLowerCase()),
    denyUnder: (policy.denyUnder ?? []).map(realPathOrSelf),
    denySegments: (policy.denySegments ?? []).map((n) => n.toLowerCase()),
    denyNames: (policy.denyNames ?? []).map((n) => n.toLowerCase()),
  };
}

function segmentsOf(path: string, home: string | undefined): string[] {
  const rel = home !== undefined && isUnderPath(path, home) ? path.slice(home.length) : path;
  return rel.split(/[\\/]+/u).filter((part) => part !== "").map((part) => part.toLowerCase());
}

/** True for a credential or settings path: checked for every entry the copy touches. */
function isDeniedPath(path: string, policy: ResolvedPolicy): boolean {
  if (policy.denyUnder.some((folder) => isUnderPath(path, folder))) return true;
  const segments = segmentsOf(path, policy.home);
  return segments.some(
    (part) => policy.denySegments.includes(part) || policy.denyNames.includes(part),
  );
}

/** True when a link may point at `target` (a real path, already not denied). */
function isAllowedLinkTarget(target: string, policy: ResolvedPolicy): boolean {
  if (policy.home === undefined || !isUnderPath(target, policy.home)) return false;
  if (policy.allowUnder.some((folder) => isUnderPath(target, folder))) return true;
  return segmentsOf(target, policy.home).some((part) => policy.allowSegments.includes(part));
}

interface ScannedFile {
  rel: string;
  size: number;
  exec: boolean;
  /** Where to read it: the file itself, or the real path a followed link points at. */
  abs: string;
  /** The directory holding `abs`, and the real path it must still have when the file is read. */
  parentAbs: string;
  parentReal: string;
}

interface TreeScan {
  dirs: string[];
  files: ScannedFile[];
  skipped: number;
  bytes: number;
  /** One line per entry (path, kind, size, mtime): the refresh fingerprint. */
  entries: string[];
}

function isUnderPath(path: string, root: string): boolean {
  const [a, b] =
    process.platform === "win32"
      ? [path.toLowerCase(), root.toLowerCase()]
      : [path, root];
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
}

function realPathOrSelf(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** Checked between entries and files, so one big root aborts promptly. */
function checkDeadline(deadlineMs: number | undefined): void {
  if (deadlineMs !== undefined && Date.now() > deadlineMs) {
    throw new Error("total budget: time limit for skill copies reached");
  }
}

/** Everything the walk shares; the helpers below take it explicitly. */
interface ScanState {
  scan: TreeScan;
  limits: CopySkillTreeLimits;
  policy: ResolvedPolicy;
  realRoot: string;
  /** Real directories already entered: a link back to one is a cycle or a repeat. */
  entered: Set<string>;
  seen: number;
  deadlineMs: number | undefined;
}

function skipEntry(state: ScanState, rel: string): void {
  state.scan.skipped += 1;
  state.scan.entries.push(`${rel}\0l`);
}

/** The real target of a link when it may be followed, else null. */
function followableTarget(state: ScanState, linkPath: string): string | null {
  let target: string;
  try {
    target = realpathSync.native(linkPath);
  } catch {
    return null; // dangling
  }
  if (isDeniedPath(target, state.policy)) return null;
  if (!isAllowedLinkTarget(target, state.policy)) return null;
  // A link into the folder being copied would copy it twice; one to an
  // ancestor of it would copy far more than the skills.
  if (isUnderPath(target, state.realRoot) || isUnderPath(state.realRoot, target)) return null;
  return target;
}

function addScannedFile(
  state: ScanState,
  rel: string,
  abs: string,
  parentAbs: string,
  parentReal: string,
  stat: { size: number; mode: number; mtimeMs: number },
): void {
  const { scan, limits } = state;
  if (scan.files.length + 1 > limits.maxFiles) {
    throw new Error(`skill root exceeds maxFiles (${limits.maxFiles})`);
  }
  scan.bytes += stat.size;
  if (scan.bytes > limits.maxBytes) {
    throw new Error(`skill root exceeds maxBytes (${limits.maxBytes})`);
  }
  scan.files.push({
    rel,
    size: stat.size,
    exec: (stat.mode & 0o100) !== 0,
    abs,
    parentAbs,
    parentReal,
  });
  scan.entries.push(`${rel}\0f\0${stat.size}\0${stat.mtimeMs}\0${stat.mode & 0o100}`);
}

function enterDirectory(
  state: ScanState,
  rel: string,
  absDir: string,
  realDir: string,
  depth: number,
  fingerprintLine: string,
): void {
  if (depth + 1 > state.limits.maxDepth) {
    throw new Error(`skill root exceeds maxDepth (${state.limits.maxDepth})`);
  }
  state.entered.add(realDir);
  state.scan.dirs.push(rel);
  state.scan.entries.push(fingerprintLine);
  walkDirectory(state, rel, absDir, realDir, depth + 1);
}

/** A link: followed only when the policy allows its target, else skipped. */
function scanLink(state: ScanState, rel: string, abs: string, depth: number): void {
  const target = followableTarget(state, abs);
  if (target === null) return skipEntry(state, rel);
  // The target is a real path, so this stat follows nothing further.
  const targetStat = statSync(target);
  if (targetStat.isDirectory()) {
    if (state.entered.has(target)) return skipEntry(state, rel);
    enterDirectory(state, rel, target, target, depth, `${rel}\0L\0${target}\0${targetStat.mtimeMs}`);
  } else if (targetStat.isFile()) {
    state.scan.entries.push(`${rel}\0L\0${target}`);
    addScannedFile(state, rel, target, dirname(target), dirname(target), targetStat);
  } else {
    skipEntry(state, rel);
  }
}

function walkDirectory(
  state: ScanState,
  relDir: string,
  absDir: string,
  expectedReal: string,
  depth: number,
): void {
  const { scan, limits } = state;
  for (const name of listNames(absDir, () => state.seen, limits, state.deadlineMs)) {
    checkDeadline(state.deadlineMs);
    // Every entry counts, so many empty dirs or links cannot dodge a cap.
    state.seen += 1;
    if (state.seen > limits.maxFiles * ENTRY_CAP_FACTOR) {
      throw new Error(`skill root exceeds maxEntries (${limits.maxFiles * ENTRY_CAP_FACTOR})`);
    }
    const rel = relDir === "" ? name : join(relDir, name);
    const abs = join(absDir, name);
    const expected = join(expectedReal, name);
    // Credentials are never copied, wherever the walk reached them from.
    if (isDeniedPath(expected, state.policy)) {
      skipEntry(state, rel);
      continue;
    }
    const stat = lstatSync(abs);
    if (stat.isSymbolicLink()) {
      scanLink(state, rel, abs, depth);
    } else if (stat.isDirectory()) {
      // A Windows junction can be reported as a plain directory: only enter
      // it when its real path is the path walked to.
      if (!sameRealPath(abs, expected)) {
        skipEntry(state, rel);
        continue;
      }
      enterDirectory(state, rel, abs, expected, depth, `${rel}\0d\0${stat.mtimeMs}`);
    } else if (stat.isFile()) {
      addScannedFile(state, rel, abs, absDir, expectedReal, stat);
    } else {
      scan.skipped += 1;
      scan.entries.push(`${rel}\0o`);
    }
  }
}

function scanTree(
  source: string,
  limits: CopySkillTreeLimits,
  policy: SkillLinkPolicy = {},
  deadlineMs?: number,
): TreeScan {
  const scan: TreeScan = { dirs: [], files: [], skipped: 0, bytes: 0, entries: [] };
  const realRoot = realpathSync.native(source);
  const state: ScanState = {
    scan,
    limits,
    policy: resolvePolicy(policy),
    realRoot,
    entered: new Set<string>([realRoot]),
    seen: 0,
    deadlineMs,
  };
  scan.entries.push(`.\0d\0${lstatSync(source).mtimeMs}`);
  walkDirectory(state, "", source, realRoot, 0);
  scan.entries.sort();
  return scan;
}

/** Directory entries, stopping once the entry cap would be passed. */
function listNames(
  dir: string,
  seenSoFar: () => number,
  limits: CopySkillTreeLimits,
  deadlineMs?: number,
): string[] {
  const cap = limits.maxFiles * ENTRY_CAP_FACTOR;
  const names: string[] = [];
  const handle = opendirSync(dir);
  try {
    for (let entry = handle.readSync(); entry !== null; entry = handle.readSync()) {
      names.push(entry.name);
      checkDeadline(deadlineMs);
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
  destination: string,
  scan: TreeScan,
  limits: CopySkillTreeLimits,
  deadlineMs?: number,
): CopySkillTreeResult {
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  for (const rel of scan.dirs) {
    mkdirSync(join(destination, rel), { mode: 0o700 });
  }
  let bytes = 0;
  for (const file of scan.files) {
    checkDeadline(deadlineMs);
    // The scan and this read resolve paths separately: re-check the parent
    // right before every open, which leaves only the open itself unchecked.
    if (!sameRealPath(file.parentAbs, file.parentReal)) {
      throw new Error("skill folder changed while it was copied");
    }
    const data = readRegularFile(file.abs, file.size);
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
 * Copy the regular files of `source` into a new `destination`. A link inside
 * the source is followed only when `policy` allows its target (real files are
 * copied, never a link); every other link and every non-regular entry is
 * skipped and counted. Throws when a limit is exceeded, a file cannot be
 * read, or `destination` already exists; it removes the partial `destination`
 * it created and never an existing one.
 */
export function copySkillTree(
  source: string,
  destination: string,
  limits: CopySkillTreeLimits,
  policy: SkillLinkPolicy = {},
): CopySkillTreeResult {
  return copyScannedInto(source, destination, scanTree(source, limits, policy), limits);
}

function copyScannedInto(
  source: string,
  destination: string,
  scan: TreeScan,
  limits: CopySkillTreeLimits,
  deadlineMs?: number,
): CopySkillTreeResult {
  if (lstatOrNull(destination) !== null) {
    throw new Error(`copy destination already exists: ${destination}`);
  }
  try {
    return copyScanned(destination, scan, limits, deadlineMs);
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
  linkPolicy: SkillLinkPolicy = defaultSkillLinkPolicy(),
): void {
  const deadlineMs = budget?.deadlineMs;
  checkDeadline(deadlineMs);
  const scan = scanTree(sourcePath, SKILL_COPY_LIMITS, linkPolicy, deadlineMs);
  const fingerprint = fingerprintOf(sourcePath, scan);
  // "old" is a previous copy (a real directory with our marker) to replace
  // atomically; "stale" is an old link or stray file, removed only once the
  // new copy is staged, so a failed copy never loses what is there now.
  let hasOldCopy = false;
  let hasStale = false;
  const existing = lstatOrNull(skills);
  if (existing !== null && existing !== undefined) {
    let marker: string | null = null;
    if (!existing.isSymbolicLink() && existing.isDirectory()) {
      try {
        marker = readFileSync(join(skills, COPY_MARKER), "utf8");
      } catch {
        // No marker: a link (a Windows junction can look like a directory) or
        // a folder that is not ours. The removal below tells them apart.
      }
    }
    if (marker === null) {
      hasStale = true;
    } else if (marker === fingerprint) {
      // Unchanged: nothing is copied, so it costs the shared budget nothing.
      return;
    } else {
      hasOldCopy = true;
    }
  }
  if (budget !== undefined) {
    budget.files -= scan.files.length;
    budget.bytes -= scan.bytes;
    if (budget.files < 0 || budget.bytes < 0) {
      throw new Error("total budget: file or size limit across skill roots reached");
    }
  }
  const suffix = randomBytes(6).toString("hex");
  const temp = join(pluginPath, `.tmp-${suffix}`);
  copyScannedInto(sourcePath, temp, scan, SKILL_COPY_LIMITS, deadlineMs);
  try {
    writeFileSync(join(temp, COPY_MARKER), fingerprint, {
      encoding: "utf8",
      mode: 0o600,
    });
    if (hasStale && !experimental_removeUnlessRealDirectory(skills)) {
      throw new Error(`refusing to replace a real directory at ${skills}`);
    }
    publishCopy(temp, skills, join(pluginPath, `.old-${suffix}`), hasOldCopy);
  } catch (error) {
    removeCopiedTree(temp);
    throw error;
  }
}

/**
 * Put the staged copy at `skills`: move the old copy aside, rename the new one
 * in, and put the old one back if that fails. Between the two renames `skills`
 * does not exist for an instant, so a reader that opens it in that window sees
 * no skills; that window is two renames wide. On failure `temp` is left for
 * the caller.
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
