import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MergeLatestMacYmlError,
  mergeLatestMacFeeds,
  mergeLatestMacYmlFiles,
  parseLatestMacYml,
  serializeLatestMacYml,
} from './merge-latest-mac-yml.mjs';

const ARM64 = `version: 2.0.3
files:
  - url: Zana-Command-Center-2.0.3-arm64.zip
    sha512: armzip
    size: 100
  - url: Zana-Command-Center-2.0.3-arm64.dmg
    sha512: armdmg
    size: 110
path: Zana-Command-Center-2.0.3-arm64.zip
sha512: armzip
releaseDate: '2026-08-31T16:02:34.538Z'
`;

const X64 = `version: 2.0.3
files:
  - url: Zana-Command-Center-2.0.3-x64.zip
    sha512: x64zip
    size: 200
  - url: Zana-Command-Center-2.0.3-x64.dmg
    sha512: x64dmg
    size: 210
path: Zana-Command-Center-2.0.3-x64.zip
sha512: x64zip
releaseDate: '2026-08-31T16:10:00.000Z'
`;

describe('merge-latest-mac-yml', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('unions files, keeps arm64 path/sha512, and uses the newer releaseDate', () => {
    const arm = parseLatestMacYml(ARM64, 'arm');
    const intel = parseLatestMacYml(X64, 'x64');
    const merged = mergeLatestMacFeeds(arm, intel);
    expect(merged.version).toBe('2.0.3');
    expect(merged.path).toBe('Zana-Command-Center-2.0.3-arm64.zip');
    expect(merged.sha512).toBe('armzip');
    expect(merged.releaseDate).toBe('2026-08-31T16:10:00.000Z');
    expect(merged.files.map((file) => file.url)).toEqual([
      'Zana-Command-Center-2.0.3-arm64.dmg',
      'Zana-Command-Center-2.0.3-arm64.zip',
      'Zana-Command-Center-2.0.3-x64.dmg',
      'Zana-Command-Center-2.0.3-x64.zip',
    ]);
  });

  it('round-trips a merged feed through serialize + parse', () => {
    const merged = mergeLatestMacFeeds(parseLatestMacYml(ARM64, 'arm'), parseLatestMacYml(X64, 'x64'));
    const again = parseLatestMacYml(serializeLatestMacYml(merged), 'out');
    expect(again).toEqual(merged);
  });

  it('writes the merged feed to disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'merge-mac-yml-'));
    roots.push(root);
    const left = join(root, 'arm.yml');
    const right = join(root, 'x64.yml');
    const out = join(root, 'out', 'latest-mac.yml');
    writeFileSync(left, ARM64);
    writeFileSync(right, X64);
    mergeLatestMacYmlFiles(left, right, out);
    const text = readFileSync(out, 'utf8');
    expect(text).toContain('Zana-Command-Center-2.0.3-arm64.zip');
    expect(text).toContain('Zana-Command-Center-2.0.3-x64.zip');
  });

  it('fails when versions differ', () => {
    const intel = parseLatestMacYml(X64.replaceAll('2.0.3', '2.0.4'), 'x64');
    expect(() => mergeLatestMacFeeds(parseLatestMacYml(ARM64, 'arm'), intel)).toThrow(
      MergeLatestMacYmlError,
    );
    expect(() => mergeLatestMacFeeds(parseLatestMacYml(ARM64, 'arm'), intel)).toThrow(
      /version mismatch/,
    );
  });

  it('fails when the Intel zip is missing', () => {
    expect(() =>
      mergeLatestMacFeeds(parseLatestMacYml(ARM64, 'arm'), parseLatestMacYml(ARM64, 'arm-dup')),
    ).toThrow(/missing \*-x64\.zip/);
  });

  it('fails when the Apple Silicon zip is missing', () => {
    expect(() =>
      mergeLatestMacFeeds(parseLatestMacYml(X64, 'x64'), parseLatestMacYml(X64, 'x64-dup')),
    ).toThrow(/missing \*-arm64\.zip/);
  });
});
