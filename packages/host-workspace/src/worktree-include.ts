import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { WORKTREE_INCLUDE_FILE_NAME } from '@zana-ai/zcc-domain';
import { pathExists, runGit } from './git.js';

export interface CopyWorktreeIncludeResult {
  copied: string[];
  skipped: string[];
  errors: string[];
}

async function hasSymlinkComponent(root: string, rel: string): Promise<boolean> {
  let path = root;
  for (const part of rel.split('/')) {
    path = join(path, part);
    try {
      if ((await lstat(path)).isSymbolicLink()) return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  return false;
}

export async function copyWorktreeIncludeFiles(sourcePath: string, targetPath: string, signal?: AbortSignal): Promise<CopyWorktreeIncludeResult> {
  const result: CopyWorktreeIncludeResult = { copied: [], skipped: [], errors: [] };
  signal?.throwIfAborted();
  const includeFile = join(sourcePath, WORKTREE_INCLUDE_FILE_NAME);
  if (!(await pathExists(includeFile))) return result;
  let contents: string;
  try {
    contents = await readFile(includeFile, 'utf8');
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }
  if (!contents.split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith('#'))) return result;

  // Git applies the include file as ignore rules, listing only matching
  // untracked files (including gitignored ones). Its native walker skips nested
  // repositories and avoids a JS lstat for every dependency/build artifact.
  // runGit bounds both execution time and output; never accept a partial list.
  const listing = await runGit(sourcePath, ['ls-files', '--others', '--ignored', `--exclude-from=${includeFile}`, '-z']);
  signal?.throwIfAborted();
  for (const rel of listing.stdout.split('\0')) {
    signal?.throwIfAborted();
    if (!rel || rel === WORKTREE_INCLUDE_FILE_NAME) continue;
    const from = join(sourcePath, rel), to = join(targetPath, rel);
    if (!isWithin(from, sourcePath) || !isWithin(to, targetPath) || rel.split(/[\\/]/).includes('..')) {
      result.errors.push(`refused path escape: ${rel}`);
      continue;
    }
    try {
      if (await hasSymlinkComponent(sourcePath, rel) || !(await lstat(from)).isFile()) {
        result.skipped.push(rel);
        continue;
      }
      if (await pathExists(to)) {
        result.skipped.push(rel);
        continue;
      }
      const parent = dirname(rel).split(sep).join('/');
      if (await hasSymlinkComponent(targetPath, parent)) {
        result.errors.push(`refused symlink destination: ${rel}`);
        continue;
      }
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to, constants.COPYFILE_EXCL);
      result.copied.push(rel);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') result.skipped.push(rel);
      else result.errors.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
