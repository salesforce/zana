import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import {
  assembleMarketplaceIndex,
  loadMarketplacePlugins,
  normalizeEntry,
  normalizeIcon
} from './build-lib.mjs';

describe('normalizeIcon', () => {
  it('lifts a lucide string into { lucide }', () => {
    assert.deepEqual(normalizeIcon('Library'), { lucide: 'Library' });
  });
});

describe('normalizeEntry', () => {
  it('rejects a file stem / id mismatch', () => {
    const result = normalizeEntry(
      {
        id: 'other',
        displayName: 'Docs',
        description: 'docs',
        author: { name: 'Zana' },
        source: { git: { url: 'https://github.com/salesforce/zana', subdir: 'plugins/docs' } }
      },
      'docs.json'
    );
    assert.equal(result.ok, false);
  });

  it('accepts a valid pointer entry', () => {
    const result = normalizeEntry(
      {
        id: 'docs',
        displayName: 'Docs',
        description: 'Durable project knowledge',
        author: { name: 'Zana', github: 'salesforce' },
        source: {
          git: { url: 'https://github.com/salesforce/zana', subdir: 'plugins/docs', ref: 'HEAD' }
        }
      },
      'docs.json'
    );
    assert.equal(result.ok, true);
    assert.equal(result.entry.id, 'docs');
  });
});

describe('assembleMarketplaceIndex', () => {
  it('emits name official and sorts by displayName', () => {
    const index = assembleMarketplaceIndex(
      {
        schemaVersion: 1,
        name: 'official',
        displayName: 'Zana official plugins',
        description: 'First-party plugins'
      },
      [
        {
          id: 'zebra',
          displayName: 'Zebra',
          description: 'z',
          author: { name: 'Zana' },
          source: { git: { url: 'https://github.com/salesforce/zana' } }
        },
        {
          id: 'alpha',
          displayName: 'Alpha',
          description: 'a',
          author: { name: 'Zana' },
          source: { git: { url: 'https://github.com/salesforce/zana' } }
        }
      ]
    );
    assert.equal(index.schemaVersion, 1);
    assert.equal(index.name, 'official');
    assert.deepEqual(
      index.plugins.map((plugin) => plugin.id),
      ['alpha', 'zebra']
    );
  });
});

describe('loadMarketplacePlugins', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zana-marketplace-'));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('builds an index from base + entries and fails on a bad entry', () => {
    writeFileSync(
      join(dir, 'marketplace.base.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: 'official',
        displayName: 'Official',
        description: 'Test'
      })
    );
    mkdirSync(join(dir, 'entries'));
    writeFileSync(
      join(dir, 'entries', 'docs.json'),
      JSON.stringify({
        id: 'docs',
        displayName: 'Docs',
        description: 'Durable project knowledge',
        author: { name: 'Zana' },
        source: { git: { url: 'https://github.com/salesforce/zana', subdir: 'plugins/docs' } }
      })
    );
    const index = loadMarketplacePlugins(dir);
    assert.equal(index.name, 'official');
    assert.equal(index.plugins.length, 1);

    writeFileSync(
      join(dir, 'entries', 'bad.json'),
      JSON.stringify({
        id: 'bad',
        displayName: 'Bad',
        description: 'missing source',
        author: { name: 'Zana' },
        source: {}
      })
    );
    assert.throws(() => loadMarketplacePlugins(dir), /source must declare npm or git/);
  });
});
