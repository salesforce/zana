import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  materializeMarketplaceIndex,
  parseMarketplaceSource,
  marketplaceSourceDisplay
} from './marketplace-source.js';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const SAMPLE_INDEX = {
  schemaVersion: 1 as const,
  name: 'official',
  displayName: 'Official',
  plugins: [
    {
      id: 'notes',
      displayName: 'Notes',
      description: 'notes plugin',
      author: { name: 'zana' },
      source: { npm: { package: '@zana/notes', range: '1.0.0' } }
    }
  ]
};

describe('parseMarketplaceSource', () => {
  it('parses https, git, git+https, and path forms', () => {
    expect(parseMarketplaceSource('https://example.test/marketplace.json')).toEqual({
      kind: 'https',
      manifestUrl: 'https://example.test/marketplace.json'
    });
    expect(parseMarketplaceSource('git:https://example.test/mp.git')).toEqual({
      kind: 'git',
      url: 'https://example.test/mp.git',
      ref: 'HEAD'
    });
    expect(parseMarketplaceSource('git:https://example.test/mp.git@v1')).toEqual({
      kind: 'git',
      url: 'https://example.test/mp.git',
      ref: 'v1'
    });
    expect(parseMarketplaceSource('git+https://example.test/mp.git@main')).toEqual({
      kind: 'git',
      url: 'https://example.test/mp.git',
      ref: 'main'
    });
    const parsed = parseMarketplaceSource('path:/tmp/catalog');
    expect(parsed).toEqual({ kind: 'path', directory: resolve('/tmp/catalog') });
  });

  it('refuses plain http and unlabeled sources', () => {
    expect(() => parseMarketplaceSource('http://example.test/mp.json')).toThrow(/https/);
    expect(() => parseMarketplaceSource('example.test/mp.json')).toThrow(/https:\/\/<manifest-url>/);
    expect(() => parseMarketplaceSource('')).toThrow(/invalid marketplace source/);
    expect(() => parseMarketplaceSource('path:')).toThrow(/empty path/);
  });

  it('round-trips display strings', () => {
    expect(marketplaceSourceDisplay(parseMarketplaceSource('https://example.test/mp.json')))
      .toBe('https://example.test/mp.json');
    expect(marketplaceSourceDisplay(parseMarketplaceSource('git:https://example.test/mp.git')))
      .toBe('git:https://example.test/mp.git');
    expect(marketplaceSourceDisplay(parseMarketplaceSource('git:https://example.test/mp.git@v2')))
      .toBe('git:https://example.test/mp.git@v2');
  });
});

describe('materializeMarketplaceIndex', () => {
  it('reads a path: directory through marketplace.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-mp-path-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'marketplace.json'), JSON.stringify(SAMPLE_INDEX));
    const index = await materializeMarketplaceIndex({ kind: 'path', directory: dir });
    expect(index.name).toBe('official');
    expect(index.plugins).toHaveLength(1);
  });

  it('fetches https catalogs through the injected fetch', async () => {
    const index = await materializeMarketplaceIndex(
      { kind: 'https', manifestUrl: 'https://example.test/mp.json' },
      async (url) => {
        expect(url).toBe('https://example.test/mp.json');
        return SAMPLE_INDEX;
      }
    );
    expect(index.displayName).toBe('Official');
  });

  it('refuses a path that is a file, not a directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-mp-file-'));
    dirs.push(dir);
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, '{}');
    await expect(materializeMarketplaceIndex({ kind: 'path', directory: file }))
      .rejects.toThrow(/does not exist/);
  });

  it('refuses a missing marketplace.json inside an otherwise valid directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zcc-mp-empty-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'nested'));
    await expect(materializeMarketplaceIndex({ kind: 'path', directory: dir }))
      .rejects.toThrow();
  });
});
