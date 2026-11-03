import {
  type Stats,
  lstatSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import {
  lstat,
  readdir,
  realpath,
  rmdir,
  unlink,
} from "node:fs/promises";
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
  const kind = classifyEntry(stat, () =>
    realPathOrNull(path) ?? null,
    expectedRealPath,
  );
  if (kind === "directory") return false;
  if (kind === "link") removeLink(path);
  else unlinkSync(path);
  return true;
}

type EntryKind = "link" | "file" | "directory";

/**
 * The one rule both walks share: what an entry is. A symlink is a link, a
 * non-directory is a file, and a directory is entered only when its real path
 * (`null` is a junction whose target is gone) is the path walked to; anything
 * else is a link the runtime did not report as one.
 */
function classifyEntry(
  stat: Pick<Stats, "isSymbolicLink" | "isDirectory">,
  realPathOf: () => string | null,
  expectedRealPath: string,
): EntryKind {
  if (stat.isSymbolicLink()) return "link";
  if (!stat.isDirectory()) return "file";
  const realPath = realPathOf();
  if (realPath === null || !samePath(realPath, expectedRealPath)) return "link";
  return "directory";
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

const YIELD_EVERY_ENTRIES = 8;

/**
 * Async twin of `removeTreeWithoutFollowingLinks`, with the same safety rules
 * (`classifyEntry` is shared) and the same stop-at-first-failure behaviour.
 * Entries are removed one at a time and the event loop is yielded to every few
 * entries, so a large tree never blocks the process for the whole walk.
 */
export async function removeTreeWithoutFollowingLinksAsync(
  root: string,
): Promise<void> {
  const path = resolve(root);
  if ((await lstatOrNullAsync(path)) === null) return;
  const walk = { entries: 0 };
  await removeEntryAsync(path, await canonicalPathAsync(path), walk);
}

async function removeEntryAsync(
  path: string,
  expectedRealPath: string,
  walk: { entries: number },
): Promise<void> {
  walk.entries += 1;
  if (walk.entries % YIELD_EVERY_ENTRIES === 0) {
    await new Promise<void>((done) => setImmediate(done));
  }
  const stat = await lstatOrNullAsync(path);
  if (stat === null) return;
  const realPath = stat.isDirectory() && !stat.isSymbolicLink()
    ? await realPathOrNullAsync(path)
    : null;
  const kind = classifyEntry(stat, () => realPath, expectedRealPath);
  if (kind === "file") {
    await unlink(path);
    return;
  }
  if (kind === "link") {
    await removeLinkAsync(path);
    return;
  }
  for (const name of await readdir(path)) {
    await removeEntryAsync(join(path, name), join(expectedRealPath, name), walk);
  }
  await rmdir(path);
}

async function canonicalPathAsync(path: string): Promise<string> {
  return join(await realpath(dirname(path)), basename(path));
}

async function removeLinkAsync(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EISDIR") throw error;
    await rmdir(path);
  }
}

async function lstatOrNullAsync(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function realPathOrNullAsync(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
