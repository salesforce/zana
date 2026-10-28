import {
  type Stats,
  lstatSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Delete a directory tree this process created, removing every link inside it
 * as a link, never the folder it points at.
 *
 * `rmSync(dir, { recursive: true })` is not safe for a tree that can hold
 * links. Electron builds Node's `rmSync` on libc++, whose Windows
 * `remove_all` reports a directory junction as a plain directory and deletes
 * the junction target's contents. Provider bridges link real user folders
 * (`~/.claude/skills`, `~/.claude/commands`, plugin skill caches) into their
 * temp dir, so that walk emptied those folders on exit.
 *
 * A directory is entered only after its real path is confirmed to be the path
 * walked to, the root included; anything else is a link the runtime did not
 * report as one, and is unlinked. Stops at the first failure and throws,
 * leaving the rest on disk: a leftover temp dir is cheap, deleting through a
 * link is not.
 */
export function removeTreeWithoutFollowingLinks(root: string): void {
  const path = resolve(root);
  if (lstatOrNull(path) === null) return;
  removeEntry(path, canonicalPath(path));
}

/**
 * Remove `path` unless it is a real directory: a link (a Windows junction the
 * runtime reports as a directory included) goes as a link, a file is unlinked,
 * and a missing path stays missing. Returns `false`, touching nothing, when
 * `path` is a real directory.
 */
export function removeUnlessRealDirectory(path: string): boolean {
  const absolute = resolve(path);
  if (lstatOrNull(absolute) === null) return true;
  return removeUnlessDirectoryAt(absolute, canonicalPath(absolute));
}

function removeEntry(path: string, expectedRealPath: string): void {
  if (removeUnlessDirectoryAt(path, expectedRealPath)) return;
  for (const name of readdirSync(path)) {
    removeEntry(join(path, name), join(expectedRealPath, name));
  }
  rmdirSync(path);
}

/**
 * Removes whatever is at `path` and returns `true`, unless it is a directory
 * whose real path is `expectedRealPath`: that is a real directory, left for
 * the caller.
 */
function removeUnlessDirectoryAt(
  path: string,
  expectedRealPath: string,
): boolean {
  const stat = lstatOrNull(path);
  if (stat === null) return true;
  if (stat.isSymbolicLink()) {
    removeLink(path);
    return true;
  }
  if (!stat.isDirectory()) {
    unlinkSync(path);
    return true;
  }
  // `null` is a junction whose target is gone: still a link, never a folder.
  const realPath = realPathOrNull(path);
  if (realPath === null || !samePath(realPath, expectedRealPath)) {
    removeLink(path);
    return true;
  }
  return false;
}

/**
 * Where `path` really is when it is not itself a link: its parent's real path
 * plus its own name. Comparing against `path`'s own real path would make a
 * link look like the folder it points at.
 */
function canonicalPath(path: string): string {
  return join(realpathSync.native(dirname(path)), basename(path));
}

/** Removes the link itself. `rmdir` on a Windows junction never touches its target. */
function removeLink(path: string): void {
  try {
    unlinkSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EISDIR") throw error;
    rmdirSync(path);
  }
}

function lstatOrNull(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function realPathOrNull(path: string): string | null {
  try {
    return realpathSync.native(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
