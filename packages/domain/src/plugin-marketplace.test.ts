import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { marketplaceIndexSchema } from './plugin-marketplace.js';

const BASE_ENTRY = {
  id: 'notes',
  displayName: 'Notes',
  description: 'A notes panel',
  author: { name: 'Zana' },
  source: { git: { url: 'https://github.com/salesforce/zana', subdir: 'plugins/notes', ref: 'HEAD' } }
};

describe('marketplaceIndexSchema', () => {
  it('accepts the official pointer catalog', () => {
    const parsed = marketplaceIndexSchema.parse({
      schemaVersion: 1,
      name: 'official',
      displayName: 'Zana official plugins',
      plugins: [BASE_ENTRY]
    });
    expect(parsed.plugins[0]?.id).toBe('notes');
    expect(parsed.plugins[0]?.source.git?.subdir).toBe('plugins/notes');
  });

  it('accepts $schema, tags, and a string lucide icon', () => {
    const parsed = marketplaceIndexSchema.parse({
      $schema: 'https://example.test/schemas/marketplace.schema.json',
      schemaVersion: 1,
      name: 'official',
      displayName: 'Official',
      plugins: [
        {
          ...BASE_ENTRY,
          icon: 'Library',
          tags: ['official', 'Context & knowledge']
        }
      ]
    });
    expect(parsed.$schema).toMatch(/marketplace\.schema\.json$/);
    expect(parsed.plugins[0]?.icon).toEqual({ lucide: 'Library' });
    expect(parsed.plugins[0]?.tags).toEqual(['official', 'Context & knowledge']);
  });

  it('accepts the generated website official catalog', () => {
    const file = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../website/content/marketplace/marketplace.json'
    );
    const parsed = marketplaceIndexSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
    expect(parsed.name).toBe('official');
    expect(parsed.plugins.length).toBeGreaterThanOrEqual(19);
  });

  it('rejects unknown index keys', () => {
    expect(() =>
      marketplaceIndexSchema.parse({
        schemaVersion: 1,
        name: 'official',
        displayName: 'Official',
        extra: true,
        plugins: [BASE_ENTRY]
      })
    ).toThrow();
  });
});
