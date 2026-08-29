import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RawDiffFileStat, WorkspaceDiffTarget } from '@zana-ai/zcc-domain';
import {
  DEFAULT_MAX_FILES,
  detectGitRepo,
  runGit,
  runGitWithNullRecordLimit,
  truncateToMaxBytes
} from './git.js';

const COMBINED_PAGE_BASE_BYTES = 64 * 1024;
const COMBINED_PAGE_PER_FILE_HEADROOM_BYTES = 4 * 1024;
const DEFAULT_MAX_BYTES_PER_FILE = 64 * 1024;
const NAME_STATUS_LETTERS = new Set(['A', 'M', 'D', 'R', 'C', 'T']);
const DIFF_SECTION_HEADER = 'diff --git ';

export interface WorkspaceDiffFilesResult {
  files: RawDiffFileStat[];
  shortstat: string;
  mergeBaseRef: string | null;
  truncated: boolean;
}

export interface WorkspaceDiffPatchEntry {
  path: string;
  patch: string;
  truncated: boolean;
}

export interface NameStatusSourceEntry {
  path: string;
  status: string;
  previousPath: string | null;
}

export interface NumstatEntry {
  path: string;
  insertions: number | null;
  deletions: number | null;
}

function includesUntracked(target: WorkspaceDiffTarget): boolean {
  return target.type === 'uncommitted' || target.type === 'all';
}

function nameStatusArgs(target: WorkspaceDiffTarget): string[] {
  if (target.type === 'commit') {
    return ['show', '--format=', '--name-status', '-M', '-z', target.sha];
  }
  if (target.type === 'uncommitted') {
    return ['diff', '--name-status', '-M', '-z', 'HEAD'];
  }
  return ['diff', '--name-status', '-M', '-z', `${target.mergeBaseBranch}...HEAD`];
}

function numstatArgs(target: WorkspaceDiffTarget): string[] {
  if (target.type === 'commit') {
    return ['show', '--format=', '--numstat', '-M', '-z', target.sha];
  }
  if (target.type === 'uncommitted') {
    return ['diff', '--numstat', '-M', '-z', 'HEAD'];
  }
  return ['diff', '--numstat', '-M', '-z', `${target.mergeBaseBranch}...HEAD`];
}

function patchArgs(target: WorkspaceDiffTarget, paths: string[]): string[] {
  if (target.type === 'commit') {
    return ['show', '--format=', '--binary', target.sha, '--', ...paths];
  }
  if (target.type === 'uncommitted') {
    return ['diff', '--binary', 'HEAD', '--', ...paths];
  }
  return ['diff', '--binary', `${target.mergeBaseBranch}...HEAD`, '--', ...paths];
}

function combinedPageBufferBudget(fileCount: number, maxBytesPerFile: number): number {
  return COMBINED_PAGE_BASE_BYTES + fileCount * (maxBytesPerFile + COMBINED_PAGE_PER_FILE_HEADROOM_BYTES);
}

function normalizeStatusLetter(status: string): RawDiffFileStat['statusLetter'] {
  const letter = status[0] ?? '';
  return NAME_STATUS_LETTERS.has(letter) ? (letter as RawDiffFileStat['statusLetter']) : 'M';
}

export function parseNameStatusSourceEntries(output: string): NameStatusSourceEntry[] {
  const tokens = output.split('\0');
  const entries: NameStatusSourceEntry[] = [];
  let index = 0;
  while (index < tokens.length) {
    const statusToken = tokens[index];
    if (!statusToken) {
      index += 1;
      continue;
    }
    const statusLetter = statusToken[0] ?? '';
    const isRenameOrCopy = statusLetter === 'R' || statusLetter === 'C';
    if (isRenameOrCopy) {
      const oldPath = tokens[index + 1];
      const newPath = tokens[index + 2];
      if (newPath) {
        entries.push({ path: newPath, status: statusLetter, previousPath: oldPath ?? null });
      }
      index += 3;
    } else {
      const pathToken = tokens[index + 1];
      if (pathToken) {
        entries.push({ path: pathToken, status: statusLetter, previousPath: null });
      }
      index += 2;
    }
  }
  return entries;
}

function parseNumstatCount(text: string): number | null {
  if (text === '-') return null;
  const value = Number.parseInt(text, 10);
  return Number.isFinite(value) ? value : null;
}

export function parseNumstatEntriesZ(output: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  let cursor = 0;
  while (cursor < output.length) {
    const firstTab = output.indexOf('\t', cursor);
    if (firstTab < 0) break;
    const secondTab = output.indexOf('\t', firstTab + 1);
    if (secondTab < 0) break;
    const insertions = parseNumstatCount(output.slice(cursor, firstTab));
    const deletions = parseNumstatCount(output.slice(firstTab + 1, secondTab));
    let path: string;
    if (output[secondTab + 1] === '\0') {
      const oldEnd = output.indexOf('\0', secondTab + 2);
      if (oldEnd < 0) break;
      const newEnd = output.indexOf('\0', oldEnd + 1);
      if (newEnd < 0) break;
      path = output.slice(oldEnd + 1, newEnd);
      cursor = newEnd + 1;
    } else {
      const end = output.indexOf('\0', secondTab + 1);
      if (end < 0) break;
      path = output.slice(secondTab + 1, end);
      cursor = end + 1;
    }
    entries.push({ path, insertions, deletions });
  }
  return entries;
}

function formatShortstat(files: RawDiffFileStat[]): string {
  if (files.length === 0) return '';
  const insertions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const parts = [`${files.length} file${files.length === 1 ? '' : 's'} changed`];
  if (insertions > 0) parts.push(`${insertions} insertion${insertions === 1 ? '' : 's'}(+)`);
  if (deletions > 0) parts.push(`${deletions} deletion${deletions === 1 ? '' : 's'}(-)`);
  return parts.join(', ');
}

function formatPatchSection(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === '') end -= 1;
  if (end === 0) return '';
  const body = lines.slice(0, end);
  const isBinary = body.some((line) => line === 'GIT binary patch');
  return `${body.join('\n')}\n${isBinary ? '\n' : ''}`;
}

export function splitPatchIntoSections(combinedPatch: string): string[] {
  if (combinedPatch.length === 0) return [];
  const lines = combinedPatch.split('\n');
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(DIFF_SECTION_HEADER)) {
      if (current !== null) sections.push(current);
      current = [line];
      continue;
    }
    if (current !== null) current.push(line);
  }
  if (current !== null) sections.push(current);
  return sections.map((sectionLines) => formatPatchSection(sectionLines));
}

function truncatePatch(patch: string, maxBytes: number): { patch: string; truncated: boolean } {
  if (maxBytes <= 0 || Buffer.byteLength(patch, 'utf8') <= maxBytes) {
    return { patch, truncated: false };
  }
  return { patch: truncateToMaxBytes(patch, maxBytes), truncated: true };
}

async function readMergeBaseRef(cwd: string, target: WorkspaceDiffTarget): Promise<string | null> {
  if (target.type !== 'branch_committed' && target.type !== 'all') return null;
  const mb = await runGit(cwd, ['merge-base', target.mergeBaseBranch, 'HEAD'], { allowFail: true });
  return mb.code === 0 ? mb.stdout.trim() || null : null;
}

function toTrackedStat(entry: NameStatusSourceEntry, numstat: NumstatEntry | undefined): RawDiffFileStat {
  const binary = numstat !== undefined && numstat.insertions === null && numstat.deletions === null;
  return {
    path: entry.path,
    previousPath: entry.previousPath,
    statusLetter: normalizeStatusLetter(entry.status),
    additions: binary ? 0 : (numstat?.insertions ?? 0),
    deletions: binary ? 0 : (numstat?.deletions ?? 0),
    binary,
    origin: 'tracked'
  };
}

async function listUntrackedPaths(
  cwd: string,
  maxRecords: number
): Promise<{ paths: string[]; truncated: boolean }> {
  if (maxRecords <= 0) return { paths: [], truncated: true };
  const listed = await runGitWithNullRecordLimit(
    cwd,
    ['ls-files', '-o', '--exclude-standard', '-z'],
    maxRecords + 1
  );
  const paths = listed.stdout.split('\0').filter(Boolean);
  const truncated = listed.truncated || paths.length > maxRecords;
  return { paths: paths.slice(0, maxRecords), truncated };
}

async function withThrowawayIndex<T>(
  cwd: string,
  paths: string[],
  work: (extraEnv: NodeJS.ProcessEnv) => Promise<T>
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-git-index-'));
  const extraEnv = { GIT_INDEX_FILE: join(dir, 'index') };
  try {
    await runGit(cwd, ['read-tree', '--empty'], { extraEnv, allowFail: true });
    if (paths.length > 0) {
      await runGit(cwd, ['add', '-N', '--', ...paths], { extraEnv, allowFail: true });
    }
    return await work(extraEnv);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function filterRequestedUntrackedPaths(cwd: string, paths: string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const listed = await runGit(cwd, ['ls-files', '-o', '--exclude-standard', '-z', '--', ...paths], {
    allowFail: true,
    overflow: 'truncate'
  });
  return new Set(listed.stdout.split('\0').filter(Boolean));
}

async function readUntrackedStats(cwd: string, paths: string[]): Promise<RawDiffFileStat[]> {
  if (paths.length === 0) return [];
  return withThrowawayIndex(cwd, paths, async (extraEnv) => {
    const numstat = await runGit(cwd, ['diff', '--numstat', '-z', '--', ...paths], {
      extraEnv,
      allowFail: true,
      overflow: 'truncate'
    });
    const byPath = new Map(parseNumstatEntriesZ(numstat.stdout).map((entry) => [entry.path, entry]));
    return paths.map((path) => {
      const entry = byPath.get(path);
      const binary = entry !== undefined && entry.insertions === null && entry.deletions === null;
      return {
        path,
        previousPath: null,
        statusLetter: 'A',
        additions: binary ? 0 : (entry?.insertions ?? 0),
        deletions: binary ? 0 : (entry?.deletions ?? 0),
        binary,
        origin: 'untracked'
      };
    });
  });
}

export async function readWorkspaceDiffFiles(
  cwd: string,
  target: WorkspaceDiffTarget,
  maxFiles = DEFAULT_MAX_FILES
): Promise<WorkspaceDiffFilesResult> {
  if (!(await detectGitRepo(cwd))) {
    return { files: [], shortstat: '', mergeBaseRef: null, truncated: false };
  }
  const mergeBaseRef = await readMergeBaseRef(cwd, target);
  const [nameStatus, numstat] = await Promise.all([
    runGit(cwd, nameStatusArgs(target), { allowFail: true, overflow: 'truncate' }),
    runGit(cwd, numstatArgs(target), { allowFail: true, overflow: 'truncate' })
  ]);
  const trackedEntries = parseNameStatusSourceEntries(nameStatus.stdout);
  const numstatByPath = new Map(parseNumstatEntriesZ(numstat.stdout).map((entry) => [entry.path, entry] as const));
  const trackedTruncated = trackedEntries.length > maxFiles || Boolean(nameStatus.truncated);
  const trackedFiles = trackedEntries
    .slice(0, maxFiles)
    .map((entry) => toTrackedStat(entry, numstatByPath.get(entry.path)));
  const remaining = maxFiles - trackedFiles.length;
  let untrackedFiles: RawDiffFileStat[] = [];
  let untrackedTruncated = false;
  if (!trackedTruncated && includesUntracked(target)) {
    if (remaining > 0) {
      const listed = await listUntrackedPaths(cwd, remaining);
      untrackedTruncated = listed.truncated;
      untrackedFiles = await readUntrackedStats(cwd, listed.paths);
    } else {
      untrackedTruncated = true;
    }
  }
  const files = [...trackedFiles, ...untrackedFiles];
  return {
    files,
    shortstat: formatShortstat(files),
    mergeBaseRef,
    truncated: trackedTruncated || untrackedTruncated
  };
}

async function readTrackedPatchesCombined(
  cwd: string,
  target: WorkspaceDiffTarget,
  paths: string[],
  maxBytesPerFile: number
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  const [nameStatus, patch] = await Promise.all([
    runGit(cwd, [...nameStatusArgs(target), '--', ...paths], { allowFail: true, overflow: 'truncate' }),
    runGit(cwd, patchArgs(target, paths), {
      allowFail: true,
      overflow: 'truncate',
      maxBuffer: combinedPageBufferBudget(paths.length, maxBytesPerFile)
    })
  ]);
  const entries = parseNameStatusSourceEntries(nameStatus.stdout);
  const sections = splitPatchIntoSections(patch.stdout);
  if (entries.length === sections.length && entries.length > 0) {
    return new Map(entries.map((entry, index) => [entry.path, sections[index] ?? ''] as const));
  }
  const byPath = new Map<string, string>();
  for (const path of paths) {
    const previous = entries.find((entry) => entry.path === path)?.previousPath;
    const pathspec = previous && previous !== path ? [previous, path] : [path];
    const single = await runGit(cwd, patchArgs(target, pathspec), {
      allowFail: true,
      overflow: 'truncate',
      maxBuffer: maxBytesPerFile + COMBINED_PAGE_PER_FILE_HEADROOM_BYTES
    });
    byPath.set(path, single.stdout);
  }
  return byPath;
}

async function readUntrackedPatchesCombined(
  cwd: string,
  paths: string[],
  maxBytesPerFile: number
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  return withThrowawayIndex(cwd, paths, async (extraEnv) => {
    const [nameStatus, patch] = await Promise.all([
      runGit(cwd, ['diff', '--name-status', '-z', '--', ...paths], {
        extraEnv,
        allowFail: true,
        overflow: 'truncate'
      }),
      runGit(cwd, ['diff', '--binary', '--', ...paths], {
        extraEnv,
        allowFail: true,
        overflow: 'truncate',
        maxBuffer: combinedPageBufferBudget(paths.length, maxBytesPerFile)
      })
    ]);
    const entries = parseNameStatusSourceEntries(nameStatus.stdout);
    const sections = splitPatchIntoSections(patch.stdout);
    if (entries.length === sections.length && entries.length > 0) {
      return new Map(entries.map((entry, index) => [entry.path, sections[index] ?? ''] as const));
    }
    const byPath = new Map<string, string>();
    for (const path of paths) {
      const single = await runGit(cwd, ['diff', '--binary', '--', path], {
        extraEnv,
        allowFail: true,
        overflow: 'truncate',
        maxBuffer: maxBytesPerFile + COMBINED_PAGE_PER_FILE_HEADROOM_BYTES
      });
      byPath.set(path, single.stdout);
    }
    return byPath;
  });
}

export async function readWorkspaceDiffPatch(
  cwd: string,
  target: WorkspaceDiffTarget,
  paths: string[],
  maxBytesPerFile = DEFAULT_MAX_BYTES_PER_FILE
): Promise<WorkspaceDiffPatchEntry[]> {
  if (paths.length === 0 || !(await detectGitRepo(cwd))) return [];
  const uniquePaths = [...new Set(paths)];
  const untrackedSet = includesUntracked(target)
    ? await filterRequestedUntrackedPaths(cwd, uniquePaths)
    : new Set<string>();
  const untrackedPaths = uniquePaths.filter((path) => untrackedSet.has(path));
  const trackedPaths = uniquePaths.filter((path) => !untrackedSet.has(path));
  const [trackedPatches, untrackedPatches] = await Promise.all([
    readTrackedPatchesCombined(cwd, target, trackedPaths, maxBytesPerFile),
    readUntrackedPatchesCombined(cwd, untrackedPaths, maxBytesPerFile)
  ]);
  return uniquePaths.map((path) => {
    const raw = trackedPatches.get(path) ?? untrackedPatches.get(path) ?? '';
    const { patch, truncated } = truncatePatch(raw, maxBytesPerFile);
    return { path, patch, truncated };
  });
}
