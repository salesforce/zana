// Adapted from BB command-discovery; see docs/third-party/BB-LICENSE.
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import type {
  HostCommandOrigin,
  HostCommandSource,
  HostProviderCommand,
} from "@zana-ai/zcc-host-daemon-contract";
import { isWithin } from "@zana-ai/zcc-path-confine";
const isPathWithinDirectory = (parent: string, child: string) =>
  isWithin(child, parent);

export const SKILL_FILE_NAME = "SKILL.md";
const MARKDOWN_FILE_EXTENSION = ".md";
const FRONTMATTER_DELIMITER = "---";

const MAX_SCAN_DEPTH = 24;
const MAX_SCAN_ENTRY_COUNT = 1_000;

interface CommandScanRootBase {
  boundaryPath?: string;
  namePrefix: string;
  skipIfManifest?: string;
  source: HostCommandSource;
  origin: HostCommandOrigin;
  skillIdentitySeed?: string;
}

interface CommandScanDirectoryRoot extends CommandScanRootBase {
  rootPath: string;
  shape: "skill" | "skill-recursive" | "skill-directory" | "command";
}

interface CommandScanFileRoot extends CommandScanRootBase {
  filePath: string;
  shape: "command-file";
}

interface CommandScanSkillFileRoot extends CommandScanRootBase {
  fallbackName: string;
  filePath: string;
  shape: "skill-file";
  source: "skill";
}

export type CommandScanRoot =
  CommandScanDirectoryRoot | CommandScanFileRoot | CommandScanSkillFileRoot;

interface DiscoverProviderCommandsArgs {
  roots: readonly CommandScanRoot[];
  diagnostics?: string[];
}

interface ScanRootArgs {
  budget: ScanBudget;
  root: CommandScanRoot;
}

interface ScanBudget {
  remainingEntries: number;
  diagnostics: string[];
}

interface SkillDirectoryCheckArgs {
  entry: Dirent;
  entryPath: string;
  root: CommandScanDirectoryRoot;
}

interface WalkMarkdownTreeArgs {
  budget: ScanBudget;
  currentPath: string;
  depth: number;
  matchedFiles: string[];
  matches: (entry: Dirent) => boolean;
}

interface ParsedFrontmatter {
  name: string | null;
  description: string | null;
  argumentHint: string | null;
  userInvocable?: boolean;
  disableModelInvocation?: boolean;
  allowedTools?: string[];
  invalid?: boolean;
  bodySummary?: string;
}

interface SkillFileMatch {
  filePath: string;
  frontmatter: ParsedFrontmatter;
  linked: boolean;
  name: string;
}

function sortDirentsByName(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name);
}

async function readDirEntries(
  dirPath: string,
  budget?: ScanBudget,
): Promise<Dirent[] | null> {
  try {
    const directory = await fs.opendir(dirPath);
    const entries: Dirent[] = [];
    for await (const entry of directory) {
      if (budget?.remainingEntries === 0) {
        break;
      }
      if (budget !== undefined) {
        budget.remainingEntries -= 1;
      }
      entries.push(entry);
    }
    return entries.sort(sortDirentsByName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" && budget)
      budget.diagnostics.push(
        `Cannot read ${dirPath}: ${(error as Error).message}`,
      );
    return null;
  }
}

function hasSupportedFrontmatterDelimiter(content: string): boolean {
  const trimmed = content.trimStart();
  return (
    trimmed.startsWith(`${FRONTMATTER_DELIMITER}\n`) ||
    trimmed.startsWith(`${FRONTMATTER_DELIMITER}\r\n`)
  );
}

function readFrontmatterString(
  data: Record<string, unknown>,
  key: string,
): string | null {
  const value = data[key];
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function parseFrontmatter(
  filePath: string,
  budget: ScanBudget,
): Promise<ParsedFrontmatter> {
  let content: string;
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 256 * 1024)
        throw new Error("Manifest too large");
      const buffer = Buffer.alloc(256 * 1024 + 1);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead > 256 * 1024) throw new Error("Manifest too large");
      content = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    budget.diagnostics.push(
      `Cannot read manifest ${filePath}: ${(error as Error).message}`,
    );
    return { name: null, description: null, argumentHint: null, invalid: true };
  }

  const bodySummary = content
    .replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"))
    ?.slice(0, 120);
  if (!hasSupportedFrontmatterDelimiter(content)) {
    return { name: null, description: null, argumentHint: null, bodySummary };
  }

  let data: Record<string, unknown>;
  try {
    const block = content
      .trimStart()
      .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    const parsed =
      block === undefined ? {} : yaml.load(block, { schema: yaml.JSON_SCHEMA });
    data =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch (error) {
    budget.diagnostics.push(
      `Invalid frontmatter in ${filePath}: ${(error as Error).message}`,
    );
    return { name: null, description: null, argumentHint: null, invalid: true };
  }

  return {
    bodySummary,
    name: readFrontmatterString(data, "name"),
    description: readFrontmatterString(data, "description"),
    argumentHint: readFrontmatterString(data, "argument-hint"),
    userInvocable: data["user-invocable"] !== false,
    disableModelInvocation: data["disable-model-invocation"] === true,
    allowedTools: Array.isArray(data["allowed-tools"])
      ? data["allowed-tools"].filter((v): v is string => typeof v === "string")
      : typeof data["allowed-tools"] === "string"
        ? data["allowed-tools"].split(",").map((v) => v.trim())
        : undefined,
  };
}

function canFollowSkillSymlink(root: CommandScanRoot): boolean {
  return root.origin === "user" && root.source === "skill";
}

async function isSkillDirectory(
  args: SkillDirectoryCheckArgs,
): Promise<boolean> {
  if (args.entry.isDirectory()) {
    return true;
  }
  if (!args.entry.isSymbolicLink() || !canFollowSkillSymlink(args.root)) {
    return false;
  }
  try {
    const stat = await fs.stat(args.entryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function statSkillFile(
  filePath: string,
  root: CommandScanRoot,
): Promise<{ linked: boolean } | null> {
  try {
    const stat = await fs.lstat(filePath);
    if (stat.isFile()) {
      return { linked: false };
    }
    if (!stat.isSymbolicLink() || !canFollowSkillSymlink(root)) {
      return null;
    }
    const targetStat = await fs.stat(filePath);
    return targetStat.isFile() ? { linked: true } : null;
  } catch {
    return null;
  }
}

async function isSymbolicLinkPath(filePath: string): Promise<boolean> {
  return (
    (await fs.lstat(filePath).catch(() => null))?.isSymbolicLink() ?? false
  );
}

async function buildRecord(
  args: CommandScanRoot,
  filePath: string,
  name: string,
  budget: ScanBudget,
): Promise<HostProviderCommand> {
  const frontmatter = await parseFrontmatter(filePath, budget);
  return {
    ...buildRecordFromFrontmatter(args, name, frontmatter),
    filePath,
    qualifiedName: name,
    linked: false,
  };
}

function buildRecordFromFrontmatter(
  args: CommandScanRoot,
  name: string,
  frontmatter: ParsedFrontmatter,
): HostProviderCommand {
  return {
    name: `${args.namePrefix}${args.source === "skill" ? (frontmatter.name ?? name) : name}`,
    source: args.source,
    origin: args.origin,
    namePrefix: args.namePrefix,
    description:
      frontmatter.description ??
      (args.source === "command" ? (frontmatter.bodySummary ?? null) : null),
    argumentHint: frontmatter.argumentHint,
    userInvocable: frontmatter.invalid
      ? false
      : (frontmatter.userInvocable ?? true),
    disableModelInvocation: frontmatter.disableModelInvocation ?? false,
    allowedTools: frontmatter.allowedTools,
  };
}

async function hasManifestMarker(
  root: CommandScanRootBase,
  skillDirPath: string,
): Promise<boolean> {
  if (root.skipIfManifest === undefined) {
    return false;
  }
  try {
    const manifestStat = await fs.lstat(
      path.join(skillDirPath, root.skipIfManifest),
    );
    return manifestStat.isFile();
  } catch {
    return false;
  }
}

async function scanSkillRootFiles(
  root: CommandScanDirectoryRoot,
  budget: ScanBudget,
): Promise<SkillFileMatch[]> {
  if ((await resolveScanRootPath(root)) === null) return [];
  const entries = await readDirEntries(root.rootPath, budget);
  if (entries === null) {
    return [];
  }
  const rootLinked = await isSymbolicLinkPath(root.rootPath);
  const matches: SkillFileMatch[] = [];
  for (const entry of entries) {
    const skillDirPath = path.join(root.rootPath, entry.name);
    if (!(await isSkillDirectory({ entry, entryPath: skillDirPath, root }))) {
      continue;
    }
    if (await hasManifestMarker(root, skillDirPath)) {
      continue;
    }
    const skillFilePath = path.join(skillDirPath, SKILL_FILE_NAME);
    const skillFile = await statSkillFile(skillFilePath, root);
    if (skillFile === null) {
      continue;
    }
    matches.push({
      filePath: skillFilePath,
      frontmatter: await parseFrontmatter(skillFilePath, budget),
      linked: rootLinked || entry.isSymbolicLink() || skillFile.linked,
      name: entry.name,
    });
  }
  return matches;
}

async function walkMarkdownTree(args: WalkMarkdownTreeArgs): Promise<void> {
  if (args.depth > MAX_SCAN_DEPTH || args.budget.remainingEntries === 0) {
    return;
  }
  const entries = await readDirEntries(args.currentPath, args.budget);
  if (entries === null) {
    return;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const entryPath = path.join(args.currentPath, entry.name);
    if (entry.isDirectory()) {
      await walkMarkdownTree({
        budget: args.budget,
        currentPath: entryPath,
        depth: args.depth + 1,
        matchedFiles: args.matchedFiles,
        matches: args.matches,
      });
      continue;
    }
    if (entry.isFile() && args.matches(entry)) {
      args.matchedFiles.push(entryPath);
    }
  }
}

async function resolveScanRootPath(
  root: CommandScanRoot,
): Promise<string | null> {
  const resolvedRoot = await fs
    .realpath("rootPath" in root ? root.rootPath : root.filePath)
    .catch(() => null);
  if (resolvedRoot === null) {
    return null;
  }
  if (root.origin !== "project" || root.boundaryPath === undefined) {
    return resolvedRoot;
  }
  const resolvedBoundary = await fs
    .realpath(root.boundaryPath)
    .catch(() => null);
  return resolvedBoundary !== null &&
    isPathWithinDirectory(resolvedBoundary, resolvedRoot)
    ? resolvedRoot
    : null;
}

async function scanRecursiveSkillRootFiles(
  root: CommandScanDirectoryRoot,
  budget: ScanBudget,
): Promise<SkillFileMatch[]> {
  const rootPath = await resolveScanRootPath(root);
  if (rootPath === null) {
    return [];
  }
  const matchedFiles: string[] = [];
  await walkMarkdownTree({
    budget,
    currentPath: rootPath,
    depth: 0,
    matchedFiles,
    matches: (entry) => entry.name === SKILL_FILE_NAME,
  });
  const linked = await isSymbolicLinkPath(root.rootPath);
  return Promise.all(
    matchedFiles.map(async (physicalFilePath) => ({
      filePath: path.join(
        root.rootPath,
        path.relative(rootPath, physicalFilePath),
      ),
      frontmatter: await parseFrontmatter(physicalFilePath, budget),
      linked,
      name: path.basename(path.dirname(physicalFilePath)),
    })),
  );
}

async function scanSingleSkillDirectoryFiles(
  root: CommandScanDirectoryRoot,
  budget: ScanBudget,
): Promise<SkillFileMatch[]> {
  if ((await resolveScanRootPath(root)) === null) return [];
  const skillFilePath = path.join(root.rootPath, SKILL_FILE_NAME);
  const skillFile = await statSkillFile(skillFilePath, root);
  if (skillFile === null) {
    return [];
  }
  return [
    {
      filePath: skillFilePath,
      frontmatter: await parseFrontmatter(skillFilePath, budget),
      linked: (await isSymbolicLinkPath(root.rootPath)) || skillFile.linked,
      name: path.basename(root.rootPath),
    },
  ];
}

async function scanSkillFileRootFiles(
  root: CommandScanSkillFileRoot,
  budget: ScanBudget,
): Promise<SkillFileMatch[]> {
  if ((await resolveScanRootPath(root)) === null) return [];
  const skillFile = await statSkillFile(root.filePath, root);
  if (skillFile === null) {
    return [];
  }
  const frontmatter = await parseFrontmatter(root.filePath, budget);
  return [
    {
      filePath: root.filePath,
      frontmatter,
      linked: skillFile.linked,
      name: frontmatter.name ?? root.fallbackName,
    },
  ];
}

async function scanSkillFiles(args: ScanRootArgs): Promise<SkillFileMatch[]> {
  const { root } = args;
  switch (root.shape) {
    case "skill":
      return scanSkillRootFiles(root, args.budget);
    case "skill-recursive":
      return scanRecursiveSkillRootFiles(root, args.budget);
    case "skill-directory":
      return scanSingleSkillDirectoryFiles(root, args.budget);
    case "skill-file":
      return scanSkillFileRootFiles(root, args.budget);
    case "command":
    case "command-file":
      return [];
  }
}

function commandNameFromPath(rootPath: string, filePath: string): string {
  const relativePath = path.relative(rootPath, filePath);
  const withoutExtension = relativePath.slice(
    0,
    relativePath.length - MARKDOWN_FILE_EXTENSION.length,
  );
  return withoutExtension.split(path.sep).join(":");
}

async function scanCommandRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "command") {
    throw new Error("scanCommandRoot requires a command root");
  }
  if ((await resolveScanRootPath(args.root)) === null) return [];
  const matchedFiles: string[] = [];
  await walkMarkdownTree({
    budget: args.budget,
    currentPath: args.root.rootPath,
    depth: 0,
    matchedFiles,
    matches: (entry) => entry.name.endsWith(MARKDOWN_FILE_EXTENSION),
  });

  const records: HostProviderCommand[] = [];
  for (const filePath of matchedFiles) {
    const name = commandNameFromPath(args.root.rootPath, filePath);
    records.push(await buildRecord(args.root, filePath, name, args.budget));
  }
  return records;
}

async function scanCommandFileRoot(
  args: ScanRootArgs,
): Promise<HostProviderCommand[]> {
  if (args.root.shape !== "command-file") {
    throw new Error("scanCommandFileRoot requires a command-file root");
  }
  if ((await resolveScanRootPath(args.root)) === null) return [];
  try {
    const stat = await fs.lstat(args.root.filePath);
    if (!stat.isFile()) {
      return [];
    }
  } catch {
    return [];
  }
  const name = path.basename(args.root.filePath, MARKDOWN_FILE_EXTENSION);
  return [await buildRecord(args.root, args.root.filePath, name, args.budget)];
}

async function scanRoot(args: ScanRootArgs): Promise<HostProviderCommand[]> {
  switch (args.root.shape) {
    case "skill":
    case "skill-recursive":
    case "skill-directory":
    case "skill-file":
      return (await scanSkillFiles(args))
        .filter((match) => !match.frontmatter.invalid)
        .map((match) => ({
          ...buildRecordFromFrontmatter(
            args.root,
            match.name,
            match.frontmatter,
          ),
          filePath: match.filePath,
          linked: match.linked,
          qualifiedName:
            "rootPath" in args.root
              ? path
                  .relative(args.root.rootPath, path.dirname(match.filePath))
                  .split(path.sep)
                  .join("/") || match.name
              : match.name,
        }));
    case "command":
      return scanCommandRoot(args);
    case "command-file":
      return scanCommandFileRoot(args);
  }
}

export async function discoverProviderCommands(
  args: DiscoverProviderCommandsArgs,
): Promise<HostProviderCommand[]> {
  const records: HostProviderCommand[] = [];
  const budget = {
    remainingEntries: MAX_SCAN_ENTRY_COUNT,
    diagnostics: args.diagnostics ?? [],
  };
  for (const root of args.roots) {
    records.push(...(await scanRoot({ budget, root })));
  }
  if (budget.remainingEntries === 0)
    budget.diagnostics.push(
      "Discovery reached the 1,000-entry limit; some entries may be missing.",
    );
  const seen = new Set<string>();
  const unique: HostProviderCommand[] = [];
  for (const record of records) {
    const physical = await fs
      .realpath(record.filePath!)
      .catch(() => record.filePath);
    const key = `${record.source}:${physical}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(record);
    }
  }
  return unique;
}
