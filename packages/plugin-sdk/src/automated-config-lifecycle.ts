import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface ConfinedConfigLeafInput {
  dataDir: string;
  ownerId: string;
  parentName: string;
}

export interface SweepConfinedConfigLeavesInput {
  dataDir: string;
  parentName: string;
  liveOwnerIds: ReadonlySet<string>;
  ttlMs: number;
  now?: number;
}

function assertInside(parent: string, child: string): void {
  const rel = relative(parent, child);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error('automated config dir escapes the data dir');
  }
}

function assertNotSymlink(path: string): void {
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error('automated config dir must not be a symlink');
  }
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_');
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new Error('invalid automated config dir owner id');
  }
  return cleaned;
}

export function confinedConfigParent(dataDir: string, parentName: string): string {
  if (
    parentName === '' ||
    parentName === '.' ||
    parentName === '..' ||
    parentName !== basename(parentName) ||
    parentName.includes('\\')
  ) {
    throw new Error('invalid automated config dir parent name');
  }
  const root = resolve(dataDir);
  const parent = join(root, parentName);
  assertInside(root, parent);
  return parent;
}

export function createConfinedConfigLeaf(input: ConfinedConfigLeafInput): string {
  const parent = confinedConfigParent(input.dataDir, input.parentName);
  const leaf = join(parent, safeSegment(input.ownerId));
  assertInside(parent, leaf);
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertNotSymlink(parent);
  chmodSync(parent, 0o700);
  try {
    assertNotSymlink(leaf);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  mkdirSync(leaf, { recursive: true, mode: 0o700 });
  assertNotSymlink(leaf);
  chmodSync(leaf, 0o700);
  return leaf;
}

export function writeAtomic0600(path: string, body: string): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, body, { mode: 0o600 });
  renameSync(tmp, path);
}

/** Point `linkPath` at an existing transcript directory without following the link later. */
export function linkProjects(realProjects: string, linkPath: string): void {
  try {
    mkdirSync(realProjects, { recursive: true });
    lstatSync(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
    try {
      symlinkSync(realProjects, linkPath, 'dir');
    } catch {
      // Best effort: the caller may create a local projects directory instead.
    }
  }
}

export function removeConfinedConfigLeaf(dataDir: string, parentName: string, leaf: string): void {
  const parent = confinedConfigParent(dataDir, parentName);
  const resolved = resolve(leaf);
  assertInside(parent, resolved);
  try {
    assertNotSymlink(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  try {
    if (lstatSync(resolved).isSymbolicLink()) {
      unlinkSync(resolved);
      return;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  rmSync(resolved, { recursive: true, force: true });
}

export function sweepConfinedConfigLeaves(input: SweepConfinedConfigLeavesInput): string[] {
  const parent = confinedConfigParent(input.dataDir, input.parentName);
  const now = input.now ?? Date.now();
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (input.liveOwnerIds.has(name)) continue;
    const leaf = join(parent, name);
    try {
      if (now - statSync(leaf).mtimeMs <= input.ttlMs) continue;
      removeConfinedConfigLeaf(input.dataDir, input.parentName, leaf);
      removed.push(name);
    } catch {
      // Best effort: a leaf that vanished or cannot be removed is retried later.
    }
  }
  return removed;
}
