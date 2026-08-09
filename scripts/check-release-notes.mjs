#!/usr/bin/env node
/**
 * Release-notes guard: fail the build unless `docs/releases/<version>.md` exists
 * for the current `package.json` version and is non-trivial.
 *
 * The "What's New" modal renders these bundled notes (electron-builder copies
 * `docs/releases` → `resourcesPath/release-notes`; see electron-builder.yml and
 * src/main/release-notes.ts). This guard is the structural fix for notes lagging
 * the version — it runs in `prebuild`/`predist` and in CI's verify job, so a
 * release physically cannot ship without its notes.
 *
 * Exit 0 = notes present + non-trivial; exit 1 = missing/too-short (with a clear
 * message telling the author which file to write).
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

/** Minimum body length (chars) that counts as real notes, not a stub. */
const MIN_NOTES_CHARS = 80;

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const version = pkg.version;
const notesFile = join(repoRoot, 'docs', 'releases', `${version}.md`);

if (!existsSync(notesFile)) {
  console.error(
    `\n✗ Release-notes guard: missing docs/releases/${version}.md\n\n` +
      `  package.json is at version ${version} but there are no release notes for it.\n` +
      `  Create docs/releases/${version}.md (see the existing files for the format)\n` +
      `  before building/publishing — the "What's New" modal bundles and renders it.\n`
  );
  process.exit(1);
}

const body = readFileSync(notesFile, 'utf8').trim();
if (body.length < MIN_NOTES_CHARS) {
  console.error(
    `\n✗ Release-notes guard: docs/releases/${version}.md is too short ` +
      `(${body.length} chars, need ≥ ${MIN_NOTES_CHARS}).\n` +
      `  Flesh out the notes before building/publishing.\n`
  );
  process.exit(1);
}

console.log(`✓ Release-notes guard: docs/releases/${version}.md present (${body.length} chars).`);
