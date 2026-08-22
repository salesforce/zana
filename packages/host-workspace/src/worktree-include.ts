import { copyFile, lstat, mkdir, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { isWithin } from '@zana-ai/zcc-path-confine';
import { WORKTREE_INCLUDE_FILE_NAME } from '@zana-ai/zcc-domain';
import { pathExists } from './git.js';

export interface CopyWorktreeIncludeResult {
  copied: string[];
  skipped: string[];
  errors: string[];
}

interface IncludePattern {
  negate: boolean;
  directoryOnly: boolean;
  raw: string;
}

function parseIncludeFile(contents: string): IncludePattern[] {
  const patterns: IncludePattern[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const negate = trimmed.startsWith('!');
    const body = negate ? trimmed.slice(1) : trimmed;
    const directoryOnly = body.endsWith('/');
    patterns.push({ negate, directoryOnly, raw: directoryOnly ? body.slice(0, -1) : body });
  }
  return patterns;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '::DS::')
    .replace(/\*/g, '[^/]*')
    .replace(/::DS::/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}$`);
}

function matches(relPath: string, isDir: boolean, patterns: IncludePattern[]): boolean {
  let included = false;
  for (const pattern of patterns) {
    if (pattern.directoryOnly && !isDir && !relPath.startsWith(`${pattern.raw}/`) && relPath !== pattern.raw) {
      const dirMatch = globToRegExp(pattern.raw.replace(/\/$/, '')).test(relPath.split('/')[0] ?? '');
      if (!dirMatch && !relPath.startsWith(pattern.raw)) continue;
    }
    const matcher = globToRegExp(pattern.raw.replace(/^\//, ''));
    const hit = matcher.test(relPath) || matcher.test(relPath.split('/').pop() ?? '');
    if (!hit) continue;
    included = !pattern.negate;
  }
  return included;
}

async function walkFiles(root: string, dir: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join('/');
    let stat;
    try {
      stat = await lstat(abs);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await walkFiles(root, abs, files);
      continue;
    }
    if (stat.isFile()) files.push(rel);
  }
}

export async function copyWorktreeIncludeFiles(sourcePath: string, targetPath: string): Promise<CopyWorktreeIncludeResult> {
  const result: CopyWorktreeIncludeResult = { copied: [], skipped: [], errors: [] };
  const includeFile = join(sourcePath, WORKTREE_INCLUDE_FILE_NAME);
  if (!(await pathExists(includeFile))) return result;
  let patterns: IncludePattern[];
  try {
    patterns = parseIncludeFile(await readFile(includeFile, 'utf8'));
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    return result;
  }
  if (patterns.length === 0) return result;
  const files: string[] = [];
  await walkFiles(sourcePath, sourcePath, files);
  for (const rel of files) {
    if (rel === WORKTREE_INCLUDE_FILE_NAME) continue;
    if (!matches(rel, false, patterns)) continue;
    const from = join(sourcePath, rel);
    const to = join(targetPath, rel);
    if (!isWithin(from, sourcePath) || !isWithin(to, targetPath)) {
      result.errors.push(`refused path escape: ${rel}`);
      continue;
    }
    try {
      const fromStat = await lstat(from);
      if (fromStat.isSymbolicLink()) {
        result.skipped.push(rel);
        continue;
      }
      if (await pathExists(to)) {
        result.skipped.push(rel);
        continue;
      }
      await mkdir(dirname(to), { recursive: true });
      await copyFile(from, to);
      result.copied.push(rel);
    } catch (error) {
      result.errors.push(`${rel}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
