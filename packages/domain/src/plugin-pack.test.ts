import { describe, expect, it } from 'vitest';
import { pluginPackIdentitySchema, pluginPackIndexSchema, pluginPackInstallRequestSchema } from './plugin-pack.js';
import { marketplaceIndexSchema } from './plugin-marketplace.js';

const pack = { id: 'essentials', displayName: 'Essentials', description: 'A curated selection', members: [{ pluginId: 'notes' }] };
const identity = { marketplaceSource: 'https://example.test/marketplace.json', packId: 'essentials' };
const request = { identity, planId: '12345678-1234-4234-8234-123456789abc', pluginIds: ['notes'] };

describe('plugin packs sidecar contracts', () => {
  it('accepts flat same-marketplace packs and explicit required members', () => {
    expect(pluginPackIndexSchema.parse({ schemaVersion: 1, packs: [pack] }).packs[0]).toEqual(pack);
    expect(pluginPackIndexSchema.parse({ schemaVersion: 1, packs: [{ ...pack, icon: 'Package', members: [{ pluginId: 'notes', required: true }] }] }).packs[0]?.members[0]?.required).toBe(true);
    expect(pluginPackIndexSchema.parse({ schemaVersion: 1, packs: [] }).packs).toEqual([]);
  });

  it('rejects duplicate IDs, nested packs, cross-marketplace members and arbitrary sources', () => {
    for (const members of [
      [{ pluginId: 'notes' }, { pluginId: 'notes' }],
      [{ packId: 'nested' }],
      [{ pluginId: 'notes', marketplace: 'other' }],
      [{ pluginId: 'notes', source: 'path:/tmp/plugin' }],
      [],
      Array.from({ length: 33 }, (_, n) => ({ pluginId: `notes-${n}` }))
    ]) expect(pluginPackIndexSchema.safeParse({ schemaVersion: 1, packs: [{ ...pack, members }] }).success).toBe(false);
    expect(pluginPackIndexSchema.safeParse({ schemaVersion: 1, packs: [pack, pack] }).success).toBe(false);
    expect(pluginPackIndexSchema.safeParse({ schemaVersion: 2, packs: [pack] }).success).toBe(false);
    expect(pluginPackIndexSchema.safeParse({ schemaVersion: 1, packs: [pack], surprise: true }).success).toBe(false);
    expect(pluginPackIndexSchema.safeParse({ schemaVersion: 1, packs: Array.from({ length: 65 }, (_, n) => ({ ...pack, id: `pack-${n}` })) }).success).toBe(false);
  });

  it('requires bounded valid identifiers and descriptions', () => {
    for (const changed of [{ id: '../escape' }, { displayName: '' }, { description: '' }, { description: 'x'.repeat(2001) }, { icon: '' }]) {
      expect(pluginPackIndexSchema.safeParse({ schemaVersion: 1, packs: [{ ...pack, ...changed }] }).success).toBe(false);
    }
    expect(pluginPackIdentitySchema.safeParse({ ...identity, marketplaceSource: '' }).success).toBe(false);
  });

  it('keeps the ordinary marketplace schema strict and unchanged for older clients', () => {
    const index = { schemaVersion: 1, name: 'test', displayName: 'Test', plugins: [] };
    expect(marketplaceIndexSchema.safeParse(index).success).toBe(true);
    expect(marketplaceIndexSchema.safeParse({ ...index, packs: [pack] }).success).toBe(false);
  });

  it('validates selected members and rejects request-side source injection', () => {
    expect(pluginPackInstallRequestSchema.parse(request)).toEqual(request);
    for (const changed of [
      { pluginIds: [] }, { pluginIds: ['notes', 'notes'] }, { pluginIds: ['../escape'] },
      { planId: 'invented' }, { source: 'path:/tmp/plugin' },
      { identity: { ...identity, source: 'path:/tmp/plugin' } }
    ]) expect(pluginPackInstallRequestSchema.safeParse({ ...request, ...changed }).success).toBe(false);
  });
});
