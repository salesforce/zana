/**
 * Tests for release-notes resolution + version-range selection. Drives the
 * resolver through a real temp dir via the `ZCC_RELEASE_NOTES_DIR` override so
 * no packaging/electron is involved.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { listReleaseNotes, getReleaseNotes, releaseNotesRoot, MAX_NOTE_BYTES } = await import(
  './release-notes.js'
);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'relnotes-'));
  process.env.ZCC_RELEASE_NOTES_DIR = dir;
});

afterEach(() => {
  delete process.env.ZCC_RELEASE_NOTES_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function write(name: string, body: string) {
  writeFileSync(join(dir, name), body, 'utf8');
}

describe('releaseNotesRoot', () => {
  it('honors the env override when it exists', () => {
    expect(releaseNotesRoot()).toBe(dir);
  });

  it('returns null when the override points nowhere', () => {
    process.env.ZCC_RELEASE_NOTES_DIR = join(dir, 'does-not-exist');
    expect(releaseNotesRoot()).toBeNull();
  });
});

describe('listReleaseNotes', () => {
  it('parses <version>.md files newest-first and ignores non-version files', async () => {
    write('1.0.0.md', '# 1.0.0\nnotes');
    write('1.0.10.md', '# 1.0.10\nnotes'); // must sort above 1.0.2 (numeric, not lexical)
    write('1.0.2.md', '# 1.0.2\nnotes');
    write('README.md', 'not a release');
    write('notes.txt', 'ignored');

    const notes = await listReleaseNotes();
    expect(notes.map((n) => n.version)).toEqual(['1.0.10', '1.0.2', '1.0.0']);
    expect(notes[0].markdown).toContain('# 1.0.10');
  });

  it('accepts a leading v in the filename', async () => {
    write('v2.1.0.md', 'body');
    const notes = await listReleaseNotes();
    expect(notes.map((n) => n.version)).toEqual(['2.1.0']);
  });

  it('skips files larger than the byte cap', async () => {
    write('9.9.9.md', 'x'.repeat(MAX_NOTE_BYTES + 1));
    write('1.0.0.md', 'ok');
    const notes = await listReleaseNotes();
    expect(notes.map((n) => n.version)).toEqual(['1.0.0']);
  });

  it('returns empty when the dir does not resolve', async () => {
    process.env.ZCC_RELEASE_NOTES_DIR = join(dir, 'nope');
    expect(await listReleaseNotes()).toEqual([]);
  });
});

describe('getReleaseNotes range selection', () => {
  beforeEach(() => {
    write('1.0.1.md', 'a');
    write('1.0.2.md', 'b');
    write('1.0.3.md', 'c');
    write('1.0.4.md', 'd');
  });

  it('returns the half-open interval (from, to]', async () => {
    const notes = await getReleaseNotes('1.0.1', '1.0.3');
    // Excludes 1.0.1 (the from bound), includes 1.0.3 (the to bound).
    expect(notes.map((n) => n.version)).toEqual(['1.0.3', '1.0.2']);
  });

  it('no upper bound when toVersion is absent', async () => {
    const notes = await getReleaseNotes('1.0.2');
    expect(notes.map((n) => n.version)).toEqual(['1.0.4', '1.0.3']);
  });

  it('no lower bound when fromVersion is absent', async () => {
    const notes = await getReleaseNotes(null, '1.0.2');
    expect(notes.map((n) => n.version)).toEqual(['1.0.2', '1.0.1']);
  });

  it('returns everything when both bounds are absent', async () => {
    const notes = await getReleaseNotes();
    expect(notes.map((n) => n.version)).toEqual(['1.0.4', '1.0.3', '1.0.2', '1.0.1']);
  });

  it('returns empty when the range excludes everything (already up to date)', async () => {
    expect(await getReleaseNotes('1.0.4', '1.0.4')).toEqual([]);
  });
});
