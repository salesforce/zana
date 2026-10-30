import { withFileMutationLock } from '@zana-ai/zcc-host-workspace';
import { readStableFile } from './read-stable-file.js';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, basename, relative, sep } from 'node:path';
import { isAbsolute } from 'node:path';
import { Buffer, isUtf8 } from 'node:buffer';
import { promises as fs, type Dirent, type Stats } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { sanitizeInheritedChildProcessEnv } from '@zana-ai/zcc-agent-process-utils';
import type {
  HostBrowseDirectoryResult,
  HostFileMetadataResult,
  HostListPathsResult,
  HostPathEntry,
  HostPathMutationResult,
  HostPathsExistResult,
  HostPickFolderResult,
  HostReadPathResult,
  HostWriteFileResult
} from '@zana-ai/zcc-contracts/host-rpc';
import { HostCommandError } from './host-command-error.js';

const execFileAsync = promisify(execFile);

export const HOST_WRITE_MAX_BYTES = 25 * 1024 * 1024;
export const LIST_PATHS_VISIT_CAP = 50_000;
const BROWSE_SKIP_NAMES = new Set(['node_modules']);


function isFsErrorWithCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === code);
}

function sha256Hex(contents: Buffer): string {
  return createHash('sha256').update(contents).digest('hex');
}

function assertAbsolute(value: string, field: string): void {
  if (!isAbsolute(value)) {
    throw new HostCommandError('invalid_path', `${field} must be absolute`);
  }
}

export interface ResolvedWriteTarget {
  writePath: string;
  parentMissing: boolean;
}

/**
 * Resolve a (possibly missing) write target through symlinks: realpath the
 * nearest existing ancestor and re-append missing segments so a symlink inside
 * a root cannot smuggle a write outside it.
 */
export async function resolveWriteTarget(resolvedPath: string): Promise<ResolvedWriteTarget> {
  try {
    return { writePath: await fs.realpath(resolvedPath), parentMissing: false };
  } catch (error) {
    if (!isFsErrorWithCode(error, 'ENOENT')) throw error;
  }

  const missingSegments = [basename(resolvedPath)];
  let ancestor = dirname(resolvedPath);
  for (;;) {
    try {
      const realAncestor = await fs.realpath(ancestor);
      return {
        writePath: join(realAncestor, ...missingSegments),
        parentMissing: missingSegments.length > 1
      };
    } catch (error) {
      if (!isFsErrorWithCode(error, 'ENOENT')) throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new HostCommandError('path_not_found', `Path does not exist: ${resolvedPath}`);
    }
    missingSegments.unshift(basename(ancestor));
    ancestor = parent;
  }
}

async function requireNonSymlinkDirectory(path: string, description: string): Promise<string> {
  const info = await fs.lstat(path);
  if (info.isSymbolicLink()) {
    throw new HostCommandError('invalid_path', `${description} must not be a symbolic link`);
  }
  if (!info.isDirectory()) {
    throw new HostCommandError('invalid_path', `${description} is not a directory`);
  }
  return fs.realpath(path);
}

export async function resolveHostFsRoot(rootPath: string | undefined, boundaryPath?: string): Promise<string | null> {
  if (rootPath === undefined) {
    if (boundaryPath !== undefined) throw new HostCommandError('invalid_path', 'A nested boundary requires an authorized root');
    return null;
  }
  assertAbsolute(rootPath, 'rootPath');
  const root = await requireNonSymlinkDirectory(rootPath, 'Root path');
  if (boundaryPath === undefined) return root;
  assertAbsolute(boundaryPath, 'boundaryPath');
  // The narrower boundary may not exist on a first write, but its nearest
  // existing ancestor must still resolve inside the registered trust anchor.
  const boundary = (await resolveWriteTarget(boundaryPath)).writePath;
  assertWithinRoot(boundary, root, 'Nested boundary');
  try { await requireNonSymlinkDirectory(boundaryPath, 'Nested boundary'); }
  catch (error) { if (!isFsErrorWithCode(error, 'ENOENT')) throw error; }
  return boundary;
}

function assertWithinRoot(candidate: string, root: string | null, label: string): void {
  if (root !== null && !isWithin(candidate, root)) {
    throw new HostCommandError('invalid_path', `${label} escapes root`);
  }
}

export async function writeHostFile(command: {
  path: string;
  rootPath?: string;
  boundaryPath?: string;
  content: string;
  contentEncoding: 'utf8' | 'base64';
  createParents: boolean;
  expectedSha256?: string | null;
  mode?: number;
}): Promise<HostWriteFileResult> {
  assertAbsolute(command.path, 'Path');
  if (command.rootPath !== undefined) assertAbsolute(command.rootPath, 'rootPath');

  const contents = Buffer.from(command.content, command.contentEncoding);
  if (contents.length > HOST_WRITE_MAX_BYTES) {
    throw new HostCommandError(
      'too_large',
      `File size ${contents.length} bytes exceeds the ${Math.floor(HOST_WRITE_MAX_BYTES / (1024 * 1024))} MB limit`
    );
  }

  const target = await resolveWriteTarget(command.path);
  return withFileMutationLock(target.writePath, () => writeResolvedHostFile(command, contents, target));
}

async function writeResolvedHostFile(
  command: {
    path: string;
    rootPath?: string;
  boundaryPath?: string;
    createParents: boolean;
    expectedSha256?: string | null;
    mode?: number;
  },
  contents: Buffer,
  target: ResolvedWriteTarget
): Promise<HostWriteFileResult> {
  if (command.rootPath !== undefined || command.boundaryPath !== undefined) {
    let realRoot: string;
    try {
      realRoot = (await resolveHostFsRoot(command.rootPath, command.boundaryPath))!;
    } catch (error) {
      if (isFsErrorWithCode(error, 'ENOENT') || (error instanceof HostCommandError && error.code === 'path_not_found')) {
        throw new HostCommandError('path_not_found', `Path does not exist: ${command.path}`);
      }
      throw error;
    }
    assertWithinRoot(target.writePath, realRoot, `Path "${command.path}"`);
  }

  if (target.parentMissing && !command.createParents) {
    throw new HostCommandError('path_not_found', `Path does not exist: ${dirname(command.path)}`);
  }

  let currentContents: Buffer | null = null;
  let currentMode: number | undefined;
  try {
    const stat = await fs.stat(target.writePath);
    if (stat.isDirectory()) {
      throw new HostCommandError('invalid_path', 'Path is a directory, not a file');
    }
    if (!stat.isFile() || stat.size > HOST_WRITE_MAX_BYTES) throw new HostCommandError('too_large', 'Existing file exceeds the write limit');
    currentMode = stat.mode & 0o777;
    currentContents = await fs.readFile(target.writePath);
  } catch (error) {
    if (!isFsErrorWithCode(error, 'ENOENT')) throw error;
  }
  const currentSha256 = currentContents === null ? null : sha256Hex(currentContents);

  if (command.expectedSha256 !== undefined && command.expectedSha256 !== currentSha256) {
    return { outcome: 'conflict', currentSha256 };
  }

  if (command.createParents) {
    await fs.mkdir(dirname(target.writePath), { recursive: true });
  }
  const writeOptions = {
    ...(command.mode !== undefined
      ? { mode: command.mode }
      : currentMode !== undefined
        ? { mode: currentMode }
        : {})
  };
  let temporaryPath: string | null = null;
  try {
    temporaryPath = `${target.writePath}.zcc-write-${randomUUID()}`;
    const handle = await fs.open(temporaryPath, 'wx', writeOptions.mode);
    try {
      await handle.writeFile(contents);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (command.expectedSha256 === null) {
      try {
        await fs.link(temporaryPath, target.writePath);
      } catch (error) {
        if (isFsErrorWithCode(error, 'EEXIST')) {
          const latest = await fs.readFile(target.writePath).catch(() => null);
          return {
            outcome: 'conflict',
            currentSha256: latest === null ? null : sha256Hex(latest)
          };
        }
        throw error;
      }
    } else {
      if (command.expectedSha256 !== undefined) {
        const latest = await fs.readFile(target.writePath).catch(() => null);
        const latestSha256 = latest === null ? null : sha256Hex(latest);
        if (latestSha256 !== command.expectedSha256) {
          return { outcome: 'conflict', currentSha256: latestSha256 };
        }
      }
      await fs.rename(temporaryPath, target.writePath);
      temporaryPath = null;
    }
  } catch (error) {
    if (isFsErrorWithCode(error, 'ENOENT')) {
      throw new HostCommandError('path_not_found', `Path does not exist: ${dirname(command.path)}`);
    }
    if (isFsErrorWithCode(error, 'ENOTDIR') || isFsErrorWithCode(error, 'EISDIR')) {
      throw new HostCommandError('invalid_path', `Cannot write file at ${command.path}`);
    }
    throw error;
  } finally {
    if (temporaryPath !== null) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  return {
    outcome: 'written',
    sha256: sha256Hex(contents),
    sizeBytes: contents.length
  };
}

export async function mkdirHostPath(command: {
  path: string;
  rootPath?: string;
  boundaryPath?: string;
  recursive: boolean;
}): Promise<HostPathMutationResult> {
  assertAbsolute(command.path, 'Path');
  const root = await resolveHostFsRoot(command.rootPath, command.boundaryPath);
  const target = await resolveWriteTarget(command.path);
  assertWithinRoot(target.writePath, root, `Path "${command.path}"`);
  await fs.mkdir(target.writePath, { recursive: command.recursive });
  return { ok: true };
}

export async function moveHostPath(command: {
  sourcePath: string;
  destinationPath: string;
  rootPath?: string;
  boundaryPath?: string;
}): Promise<HostPathMutationResult> {
  assertAbsolute(command.sourcePath, 'Path');
  assertAbsolute(command.destinationPath, 'destinationPath');
  const sourceInfo = await fs.lstat(command.sourcePath);
  if (sourceInfo.isSymbolicLink()) {
    throw new HostCommandError('invalid_path', `Path "${command.sourcePath}" must not be a symbolic link`);
  }
  const [source, root] = await Promise.all([
    fs.realpath(command.sourcePath),
    resolveHostFsRoot(command.rootPath, command.boundaryPath)
  ]);
  assertWithinRoot(source, root, `Path "${command.sourcePath}"`);
  const parent = await fs.realpath(dirname(command.destinationPath));
  const destination = join(parent, basename(command.destinationPath));
  assertWithinRoot(destination, root, `Path "${command.destinationPath}"`);
  try {
    await fs.lstat(destination);
    throw new HostCommandError('path_exists', `Destination already exists: ${command.destinationPath}`);
  } catch (error) {
    if (error instanceof HostCommandError) throw error;
    if (!isFsErrorWithCode(error, 'ENOENT')) throw error;
  }
  await fs.rename(source, destination);
  return { ok: true };
}

export async function removeHostPath(command: {
  path: string;
  rootPath?: string;
  boundaryPath?: string;
  recursive: boolean;
  expectedSha256?: string;
}): Promise<HostPathMutationResult> {
  assertAbsolute(command.path, 'Path');
  const target = await resolveWriteTarget(command.path);
  return withFileMutationLock(target.writePath, async () => {
    const info = await fs.lstat(command.path);
    if (info.isSymbolicLink()) {
      throw new HostCommandError('invalid_path', `Path "${command.path}" must not be a symbolic link`);
    }
    const [resolved, root] = await Promise.all([fs.realpath(command.path), resolveHostFsRoot(command.rootPath, command.boundaryPath)]);
    if (resolved !== target.writePath) throw new HostCommandError('conflict', 'Path changed while waiting to remove it');
    assertWithinRoot(resolved, root, `Path "${command.path}"`);
    if (root !== null && resolved === root) throw new HostCommandError('invalid_path', 'Cannot remove the declared root');
    const targetInfo = await fs.lstat(resolved);
    if (command.expectedSha256 !== undefined) {
      if (!targetInfo.isFile() || targetInfo.size > HOST_WRITE_MAX_BYTES) throw new HostCommandError('invalid_path', 'Revision-checked removal requires a bounded regular file');
      const current = await fs.readFile(resolved);
      if (sha256Hex(current) !== command.expectedSha256) throw new HostCommandError('conflict', 'File changed concurrently. Read it again before removing it.');
    }
    if (targetInfo.isDirectory() && !command.recursive) await fs.rmdir(resolved);
    else await fs.rm(resolved, { recursive: command.recursive, force: false });
    return { ok: true };
  });
}

export async function browseHostDirectory(command: {
  path?: string;
}): Promise<HostBrowseDirectoryResult> {
  const requestedPath = command.path ?? homedir();
  assertAbsolute(requestedPath, 'Path');
  const stat = await fs.stat(requestedPath);
  if (!stat.isDirectory()) {
    throw new HostCommandError('invalid_path', `Path "${requestedPath}" is not a directory`);
  }
  const directory = await fs.realpath(requestedPath);
  const dirents = await fs.readdir(directory, { withFileTypes: true });
  const entries: HostBrowseDirectoryResult['entries'] = [];
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue;
    if (BROWSE_SKIP_NAMES.has(dirent.name)) continue;
    const fullPath = join(directory, dirent.name);
    let kind: 'file' | 'directory';
    if (dirent.isSymbolicLink()) {
      try {
        kind = (await fs.stat(fullPath)).isDirectory() ? 'directory' : 'file';
      } catch {
        continue;
      }
    } else if (dirent.isDirectory()) {
      kind = 'directory';
    } else if (dirent.isFile()) {
      kind = 'file';
    } else {
      continue;
    }
    entries.push({ kind, name: dirent.name, path: fullPath });
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  const parent = dirname(directory);
  return {
    directory,
    parent: parent === directory ? null : parent,
    entries
  };
}

export async function checkHostPathsExist(command: {
  paths: readonly string[];
}): Promise<HostPathsExistResult> {
  const unique = [...new Set(command.paths)];
  const entries = await Promise.all(unique.map(async (path) => {
    assertAbsolute(path, 'Path');
    try {
      await fs.access(path);
      return [path, true] as const;
    } catch {
      return [path, false] as const;
    }
  }));
  return { existence: Object.fromEntries(entries) };
}

function posixRelative(root: string, fullPath: string): string {
  return relative(root, fullPath).split(sep).join('/');
}

export function rankListedPath(path: string, query: string): { score: number; positions: number[] } | null {
  if (!query) return { score: 0, positions: [] };
  const hay = path.toLowerCase();
  const needle = query.toLowerCase();
  const found = hay.indexOf(needle);
  if (found >= 0) {
    return {
      score: 10_000 - found,
      positions: Array.from({ length: needle.length }, (_, index) => found + index)
    };
  }
  const positions: number[] = [];
  let from = 0;
  for (const ch of needle) {
    const at = hay.indexOf(ch, from);
    if (at < 0) return null;
    positions.push(at);
    from = at + 1;
  }
  const span = positions[positions.length - 1]! - positions[0]! + 1;
  return { score: 1_000 - span - positions[0]!, positions };
}

interface ListedPath {
  kind: 'file' | 'directory';
  path: string;
  name: string;
}

async function matchesExactHostName(root: string, path: string, actualName: string, expectedName: string): Promise<boolean> {
  if (actualName === expectedName) return true;
  if (actualName.toLocaleLowerCase('en-US') !== expectedName.toLocaleLowerCase('en-US')) return false;
  try {
    const actual = await fs.realpath(join(root, path));
    const requested = await fs.realpath(join(root, dirname(path), expectedName));
    return actual === requested;
  } catch {
    return false;
  }
}

function shouldStopWalk(command: { deadline?: number; stopAfter?: number }, pathCount: number, visits: number): boolean {
  if (command.deadline !== undefined && Date.now() >= command.deadline) return true;
  if (command.stopAfter !== undefined && pathCount >= command.stopAfter) return true;
  return visits >= LIST_PATHS_VISIT_CAP;
}

async function processListedEntry(
  entry: Dirent,
  dir: string,
  command: { root: string; includeFiles: boolean; includeDirectories: boolean; exactName?: string },
  stack: string[]
): Promise<ListedPath | null> {
  if (entry.name.startsWith('.') || BROWSE_SKIP_NAMES.has(entry.name) || entry.isSymbolicLink()) return null;
  const fullPath = join(dir, entry.name);
  const rel = posixRelative(command.root, fullPath);
  if (!rel || rel.startsWith('..')) return null;
  if (entry.isDirectory()) {
    stack.push(fullPath);
    return command.includeDirectories ? { kind: 'directory', path: rel, name: entry.name } : null;
  }
  if (entry.isFile() && command.includeFiles) {
    if (!command.exactName) return { kind: 'file', path: rel, name: entry.name };
    if (await matchesExactHostName(command.root, rel, entry.name, command.exactName)) {
      return { kind: 'file', path: rel, name: entry.name };
    }
  }
  return null;
}

async function walkListedPaths(command: {
  root: string;
  includeFiles: boolean;
  includeDirectories: boolean;
  stopAfter?: number;
  exactName?: string;
  deadline?: number;
}): Promise<{ paths: ListedPath[]; truncated: boolean }> {
  const paths: ListedPath[] = [];
  const stack = [command.root];
  let visits = 0;
  let truncated = false;
  while (stack.length > 0) {
    if (shouldStopWalk(command, paths.length, visits)) { truncated = true; break; }
    const dir = stack.pop()!;
    let directory;
    try { directory = await fs.opendir(dir); }
    catch { if (command.exactName) truncated = true; continue; }
    try {
      for await (const entry of directory) {
        visits += 1;
        if (shouldStopWalk(command, paths.length, visits)) { truncated = true; break; }
        const listed = await processListedEntry(entry, dir, command, stack);
        if (listed) paths.push(listed);
        if (shouldStopWalk(command, paths.length, visits)) { truncated = true; break; }
      }
    } catch {
      if (command.exactName) truncated = true;
    } finally {
      await directory.close?.().catch(() => {});
    }
  }
  return { paths, truncated };
}

export async function listHostPaths(command: {
  path: string;
  query?: string;
  exactName?: string;
  timeoutMs?: number;
  limit: number;
  includeFiles: boolean;
  includeDirectories: boolean;
}): Promise<HostListPathsResult> {
  assertAbsolute(command.path, 'Path');
  const info = await fs.lstat(command.path);
  if (info.isSymbolicLink()) {
    throw new HostCommandError('invalid_path', `Path "${command.path}" must not be a symbolic link`);
  }
  if (!info.isDirectory()) {
    throw new HostCommandError('invalid_path', `Path "${command.path}" is not a directory`);
  }
  const root = await fs.realpath(command.path);
  const query = command.query?.trim() ?? '';
  const deadline = command.exactName
    ? Date.now() + Math.min(command.timeoutMs ?? 5000, 5000)
    : undefined;
  const walked = await walkListedPaths({
    root,
    includeFiles: command.includeFiles,
    includeDirectories: command.includeDirectories,
    ...(!query && !command.exactName ? { stopAfter: command.limit + 1 } : {}),
    ...(command.exactName ? { exactName: command.exactName, deadline } : {})
  });
  const ranked: HostPathEntry[] = [];
  for (const entry of walked.paths) {
    const match = command.exactName
      ? { score: 0, positions: [] }
      : rankListedPath(entry.path, query);
    if (!match) continue;
    ranked.push({
      kind: entry.kind,
      path: entry.path,
      name: entry.name,
      score: match.score,
      positions: match.positions
    });
  }
  ranked.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const truncated = walked.truncated || ranked.length > command.limit;
  return {
    paths: ranked.slice(0, command.limit),
    truncated
  };
}

async function resolveExistingFile(command: {
  path: string;
  rootPath?: string;
  boundaryPath?: string;
}): Promise<{ realPath: string; stat: Stats }> {
  assertAbsolute(command.path, 'Path');
  const root = await resolveHostFsRoot(command.rootPath, command.boundaryPath);
  let realPath: string;
  try {
    realPath = await fs.realpath(command.path);
  } catch (error) {
    if (isFsErrorWithCode(error, 'ENOENT')) {
      throw new HostCommandError('path_not_found', `Path does not exist: ${command.path}`);
    }
    throw error;
  }
  assertWithinRoot(realPath, root, `Path "${command.path}"`);
  const stat = await fs.stat(realPath);
  if (!stat.isFile()) {
    throw new HostCommandError('invalid_path', `Path "${command.path}" is not a file`);
  }
  return { realPath, stat };
}

export async function readHostPath(command: {
  path: string;
  rootPath?: string;
  boundaryPath?: string;
}): Promise<HostReadPathResult> {
  const { realPath, stat } = await resolveExistingFile(command);
  if (stat.size > HOST_WRITE_MAX_BYTES) {
    throw new HostCommandError(
      'too_large',
      `File size ${stat.size} bytes exceeds the ${Math.floor(HOST_WRITE_MAX_BYTES / (1024 * 1024))} MB limit`
    );
  }
  const contents = await readStableFile(realPath, stat, HOST_WRITE_MAX_BYTES);
  const contentEncoding = isUtf8(contents) ? 'utf8' as const : 'base64' as const;
  return {
    path: command.path,
    content: contents.toString(contentEncoding),
    contentEncoding,
    sizeBytes: contents.length,
    modifiedAtMs: Math.max(0, Math.floor(stat.mtimeMs)),
    sha256: sha256Hex(contents)
  };
}

export async function readHostFileMetadata(command: {
  path: string;
  rootPath?: string;
  boundaryPath?: string;
}): Promise<HostFileMetadataResult> {
  const { stat } = await resolveExistingFile(command);
  return {
    path: command.path,
    modifiedAtMs: Math.max(0, Math.floor(stat.mtimeMs)),
    sizeBytes: stat.size
  };
}

export type FolderPickerExec = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv }
) => Promise<{ stdout: string }>;

export async function pickHostFolder(options?: {
  platform?: NodeJS.Platform;
  execFile?: FolderPickerExec;
}): Promise<HostPickFolderResult> {
  const platform = options?.platform ?? process.platform;
  if (platform !== 'darwin') {
    throw new HostCommandError('unsupported_platform', 'Folder picker is only supported on macOS');
  }
  const run = options?.execFile ?? execFileAsync;
  let stdout: string;
  try {
    const result = await run(
      'osascript',
      [
        '-e',
        'try\nPOSIX path of (choose folder with prompt "Choose a project folder")\non error number -128\nreturn ""\nend try'
      ],
      {
        env: sanitizeInheritedChildProcessEnv({ env: process.env })
      }
    );
    stdout = result.stdout;
  } catch (error) {
    throw new HostCommandError(
      'folder_picker_failed',
      `Folder picker failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const selectedPath = stdout.trim();
  return { path: selectedPath === '' ? null : selectedPath.replace(/\/$/, '') };
}
