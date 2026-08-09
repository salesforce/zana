import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { RegistryIndex } from '@zana-ai/zcc-extension-sdk';

/**
 * Guard the SHIPPED sample registry (`examples/registry/`) against the real
 * engine's contracts. The sample is the first thing a user points
 * `~/.zcc/extension-registry.json` at — if its `index.json` sha256 drifts from
 * the archive bytes (e.g. the gus archive is regenerated but the index isn't
 * re-published), every new user's first Marketplace install fails the integrity
 * gate with a `sha256 mismatch`. Nothing else tests the committed fixture, so it
 * can rot silently. This locks: index shape, sha256 = archive bytes,
 * `decodeArchive` accepts the archive, and the archive manifest agrees with the
 * release id/version. Pure file reads — no network, no install side effects.
 */

const REGISTRY_DIR = resolve(__dirname, '../../../examples/registry');

async function importRegistry() {
  return await import('../extension-registry.js');
}

function sha256Hex(b: Uint8Array): string {
  return createHash('sha256').update(b).digest('hex');
}

describe('shipped sample registry (examples/registry)', () => {
  const index: RegistryIndex = JSON.parse(
    readFileSync(resolve(REGISTRY_DIR, 'index.json'), 'utf-8')
  );

  it('is a schema-1 index with at least one release', () => {
    expect(index.schema).toBe(1);
    expect(Array.isArray(index.releases)).toBe(true);
    expect(index.releases.length).toBeGreaterThan(0);
  });

  it('every release has an HTTPS url (the engine rejects non-HTTPS)', () => {
    for (const r of index.releases) {
      expect(r.url, `release ${r.id}@${r.version}`).toMatch(/^https:\/\//i);
    }
  });

  it('each release sha256 matches its committed archive bytes', () => {
    for (const r of index.releases) {
      // url basename is the archive filename living beside index.json.
      const archiveName = r.url.split('/').pop()!;
      const bytes = new Uint8Array(readFileSync(resolve(REGISTRY_DIR, archiveName)));
      expect(sha256Hex(bytes), `sha256 for ${archiveName}`).toBe(r.sha256.toLowerCase());
    }
  });

  it('each archive decodes through the real engine and agrees with the release', async () => {
    const { decodeArchive } = await importRegistry();
    for (const r of index.releases) {
      const archiveName = r.url.split('/').pop()!;
      const bytes = new Uint8Array(readFileSync(resolve(REGISTRY_DIR, archiveName)));
      const files = decodeArchive(bytes);
      expect(files['extension.json'], `${archiveName} has a manifest`).toBeDefined();
      const manifest = JSON.parse(Buffer.from(files['extension.json']).toString('utf-8'));
      expect(manifest.id).toBe(r.id);
      expect(manifest.version).toBe(r.version);
    }
  });
});
