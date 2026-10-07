#!/usr/bin/env node
/**
 * Release-notes guard: fail the build unless `docs/releases/<version>.md` exists
 * for the current `package.json` version and will render everywhere it is shown.
 *
 * One file, three surfaces:
 *   1. The GitHub release body — release.yml `body_path` copies it into the draft.
 *   2. The update banner's "What's new" PREVIEW, before installing — the app reads
 *      that body back from the release feed (electron-updater, as GitHub-rendered
 *      HTML) and main reduces it to a markdown subset
 *      (apps/desktop/src/update-release-notes.ts).
 *   3. The post-install "What's New" modal — electron-builder bundles
 *      `docs/releases` → `resourcesPath/release-notes`.
 *
 * So beyond "present and non-trivial", the notes must stay within what survives
 * surface 2: no tables, images or raw HTML (dropped by the feed conversion), and
 * no longer than the per-note cap (truncated). When run in the release workflow
 * (`GITHUB_REF_NAME=v…`), the tag must also match package.json — the feed
 * version comes from package.json, while `body_path` is derived from the tag.
 * Runs in CI's release `verify` job (`pnpm run check:release-notes`).
 *
 * Exit 0 = notes OK; exit 1 = a problem (with a message naming the file to fix).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

/** Minimum body length (chars) that counts as real notes, not a stub. */
export const MIN_NOTES_CHARS = 80;
/** Must equal MAX_UPDATE_NOTE_CHARS in apps/desktop/src/update-release-notes.ts (guarded by a test). */
export const MAX_NOTES_CHARS = 32 * 1024;

/** Markdown with fenced blocks and inline code removed — code may mention `<tags>` or `|` freely. */
function proseOnly(body) {
  return body.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
}

/**
 * Pure check over one notes file. Returns a list of problems (empty = OK).
 * `body` is null when the file is missing; `tag` is the pushed git tag, if any.
 */
export function checkReleaseNotes({ version, body, tag }) {
  const file = `docs/releases/${version}.md`;
  if (tag && /^v\d/.test(tag) && tag !== `v${version}`) {
    return [`tag ${tag} does not match package.json version ${version} — bump package.json (and ${file}) before tagging.`];
  }
  if (body == null) {
    return [`missing ${file}. package.json is at ${version} but there are no release notes for it — create ${file} (see the existing files for the format).`];
  }
  const text = body.trim();
  const problems = [];
  if (text.length < MIN_NOTES_CHARS) problems.push(`${file} is too short (${text.length} chars, need ≥ ${MIN_NOTES_CHARS}).`);
  if (text.length > MAX_NOTES_CHARS) {
    problems.push(`${file} is ${text.length} chars; the update banner preview truncates notes past ${MAX_NOTES_CHARS}.`);
  }
  const prose = proseOnly(text);
  const lineOf = (re) => prose.split('\n').findIndex((line) => re.test(line)) + 1;
  const unsupported = [
    [/!\[[^\]]*\]\(/, 'an image'],
    [/^\s*\|.*\|\s*$/, 'a table'],
    [/<\/?[a-zA-Z][^>]*>/, 'raw HTML']
  ];
  for (const [re, what] of unsupported) {
    const line = lineOf(re);
    if (line > 0) {
      problems.push(`${file} contains ${what} (near line ${line}); the update banner preview drops it. Use headings, paragraphs, lists, emphasis, links and code only.`);
    }
  }
  return problems;
}

export function runReleaseNotesGuard({ root = repoRoot, tag = process.env.GITHUB_REF_NAME, log = console.log, error = console.error } = {}) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const version = pkg.version;
  const notesFile = join(root, 'docs', 'releases', `${version}.md`);
  const body = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : null;
  const problems = checkReleaseNotes({ version, body, tag });
  if (problems.length > 0) {
    error(`\n✗ Release-notes guard:\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    return 1;
  }
  log(`✓ Release-notes guard: docs/releases/${version}.md present (${body.trim().length} chars).`);
  return 0;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = runReleaseNotesGuard();
