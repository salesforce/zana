/**
 * Curated in-app release notes — the data behind the "What's New" modal.
 *
 * The app ships one `docs/releases/<version>.md` per release; electron-builder's
 * `extraResources` copies that dir to `process.resourcesPath/release-notes` (see
 * `electron-builder.yml`). This module resolves that dir (packaged) or the repo
 * `docs/releases` (dev), parses each `<version>.md` into a {@link ReleaseNote},
 * and selects the notes for a version range so the renderer can show everything
 * a user missed between two launches.
 *
 * Design discipline (mirrors `updater.ts`): bounded + degrade-closed. It reads a
 * small directory (capped at {@link MAX_NOTES_FILES}, per-file size capped at
 * {@link MAX_NOTE_BYTES}) and NEVER throws — any resolver/parse failure yields an
 * empty array, so a missing/corrupt notes dir just leaves the modal empty rather
 * than breaking boot.
 *
 * Version selection re-uses the SDK's {@link compareVersions} (the same helper
 * the extension registry uses); we do not hand-roll semver here.
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { compareVersions } from '@zana-ai/zcc-extension-sdk';
import type { ReleaseNote } from '@zana-ai/zcc-domain/product';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Max notes files we will enumerate — a defensive bound (Rule 5). */
export const MAX_NOTES_FILES = 200;
/** Max bytes we read from any single notes file. */
export const MAX_NOTE_BYTES = 256 * 1024;

/**
 * A `<version>.md` filename → version string. Accepts a leading `v` and the
 * usual semver-ish tokens (digits, dots, `-`/`+` pre-release/build). Returns
 * null for anything that isn't a plausible version filename (README.md etc.).
 */
function versionFromFilename(name: string): string | null {
  const m = /^v?([0-9][\w.+-]*)\.md$/i.exec(name);
  if (!m) return null;
  const v = m[1];
  // Guard against pathological lengths landing in a renderer-visible surface.
  if (v.length > 64) return null;
  // Must start with a digit and contain at least one dot (x.y[.z]).
  if (!/^\d+(\.\d+)+/.test(v)) return null;
  return v;
}

/**
 * Resolve the directory holding the bundled `<version>.md` notes. Mirrors
 * `local-extension.ts` `templateRoot`: a test override
 * (`ZCC_RELEASE_NOTES_DIR`) is authoritative; packaged builds read
 * `process.resourcesPath/release-notes` (electron-builder `extraResources`); dev
 * reads the committed source (`__dirname = out/main`, so `../../docs/releases`).
 * Returns the first that exists, or null.
 */
export function releaseNotesRoot(): string | null {
  const override = process.env.ZCC_RELEASE_NOTES_DIR;
  if (override) return existsSync(override) ? override : null;
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'release-notes') : null,
    join(__dirname, '../../docs/releases')
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Read + parse every bundled notes file, newest-version first. Never throws.
 * Files that aren't `<version>.md`, exceed {@link MAX_NOTE_BYTES}, or fail to
 * read are skipped.
 */
export async function listReleaseNotes(): Promise<ReleaseNote[]> {
  const root = releaseNotesRoot();
  if (!root) return [];
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return [];
  }
  const versioned = names
    .map((name) => ({ name, version: versionFromFilename(name) }))
    .filter((e): e is { name: string; version: string } => e.version != null)
    .slice(0, MAX_NOTES_FILES);

  const notes: ReleaseNote[] = [];
  for (const { name, version } of versioned) {
    const full = join(root, name);
    try {
      const info = await stat(full);
      if (!info.isFile() || info.size > MAX_NOTE_BYTES) continue;
      const markdown = await readFile(full, 'utf8');
      notes.push({ version, markdown });
    } catch {
      // Skip an unreadable file rather than failing the whole set.
    }
  }
  // Newest version first.
  notes.sort((a, b) => compareVersions(b.version, a.version));
  return notes;
}

/**
 * Notes for the half-open interval `(fromVersion, toVersion]`, newest first.
 *
 * - `toVersion` absent ⇒ no upper bound (all versions above `fromVersion`).
 * - `fromVersion` absent ⇒ no lower bound (everything up to `toVersion`).
 *
 * Both bounds are advisory hints from the caller; the result is always clamped
 * to the versions that actually ship on disk (Rule 1 — a renderer-supplied range
 * can never conjure notes that aren't bundled). Never throws.
 */
export async function getReleaseNotes(
  fromVersion?: string | null,
  toVersion?: string | null
): Promise<ReleaseNote[]> {
  const all = await listReleaseNotes();
  return all.filter((n) => {
    if (fromVersion && compareVersions(n.version, fromVersion) <= 0) return false;
    if (toVersion && compareVersions(n.version, toVersion) > 0) return false;
    return true;
  });
}
