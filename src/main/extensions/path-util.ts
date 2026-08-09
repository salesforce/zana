/**
 * Tiny electron-free path containment helper, shared by the extension scanner
 * (discovery.ts) and core (index.ts). Both need to verify a resolved path lives
 * inside a parent dir before reading/importing it — discovery.ts is
 * intentionally electron-free, so this lives apart from index.ts to keep that.
 */

import { relative, isAbsolute, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';

/**
 * True when `child` resolves to `parent` itself or a path nested inside it.
 * Uses `relative()` + a `..`/absolute check (cross-platform; no separator
 * assumption) rather than a string-prefix compare. `child` must be absolute.
 */
export function isWithin(child: string, parent: string): boolean {
  if (!isAbsolute(child)) return false;
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Resolve `entry` relative to `dir` and return the absolute path only if it
 * stays within `dir`; null on escape (e.g. a `../../evil.js` manifest entry).
 */
export function resolveContained(dir: string, entry: string): string | null {
  const target = resolve(dir, entry);
  return isWithin(target, resolve(dir)) ? target : null;
}

/**
 * Lexical containment ({@link resolveContained}) is not enough on its own: a
 * symlink COMMITTED inside `dir` resolves lexically-clean but its realpath can
 * point outside the extension dir, letting the loader read/import a file past
 * containment (an attacker-controlled tree — e.g. a git repo — can ship such a
 * symlink). This does the lexical check, then `realpath`s BOTH the target and
 * `dir` and re-verifies containment on the resolved paths. Returns the resolved
 * (real) target path on success, or null on escape / missing file.
 *
 * Note the staging scrub in the installer already refuses symlinks in a cloned
 * tree; this is the defense-in-depth twin at the single read seam, so it also
 * protects hand-dropped and legacy installs.
 */
export async function resolveContainedReal(dir: string, entry: string): Promise<string | null> {
  const lexical = resolveContained(dir, entry);
  if (!lexical) return null;
  try {
    const realDir = await realpath(resolve(dir));
    const realTarget = await realpath(lexical);
    return isWithin(realTarget, realDir) ? realTarget : null;
  } catch {
    return null; // missing file, broken symlink, etc.
  }
}
