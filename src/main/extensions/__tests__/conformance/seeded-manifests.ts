/**
 * Shared fixture loader for the Wave-1 conformance net.
 *
 * ONE place the seeded-extension roster lives (surface #2 — the BUILT ARTIFACT
 * under `bundled-extensions/<id>`, the dir electron-builder packs into the app
 * as `extensions/` and that `discoverExtensions` reseeds from). The W1-2 lesson:
 * a capability/manifest change is only real once it lands on THIS artifact, not
 * the source `extensions/<id>/extension.json` that never runs. So the net drives
 * the REAL discovery pipeline (`validateManifest` → `toManifestView`, both
 * private, run inside the exported `discoverExtensions`) against a temp
 * `ZCC_EXTENSIONS_DIR` seeded from the artifact — zero source edits.
 *
 * Only `zana` is seeded here. `zana-hub` is unseeded, and Consensus is no
 * longer a shipped plugin — neither appears in this roster.
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionEntry } from '@shared/types';

/** The ids seeded into the packaged app. The single source of this list. */
export const SEEDED_IDS = ['zana'] as const;
export type SeededId = (typeof SEEDED_IDS)[number];

/**
 * Repo root, derived from this file's location:
 * `src/main/extensions/__tests__/conformance/` → five parents up.
 */
const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(CONFORMANCE_DIR, '../../../../../');

/** The built-artifact surface the net snapshots against (surface #2). */
export const ARTIFACT_ROOT = join(REPO_ROOT, 'bundled-extensions');

/**
 * Seed a temp `ZCC_EXTENSIONS_DIR` from the built artifacts, run the REAL
 * `discoverExtensions` → `toEntry` pipeline over it, and return the entries
 * keyed by id. The temp dir is removed before returning — every entry carries
 * its manifest in memory, so downstream assertions never touch the files again
 * (do NOT assert on `entry.path` contents; the dir is gone).
 */
export async function loadSeededEntries(): Promise<Map<string, ExtensionEntry>> {
  const extDir = await mkdtemp(join(tmpdir(), 'cc-conformance-'));
  const prev = process.env.ZCC_EXTENSIONS_DIR;
  try {
    for (const id of SEEDED_IDS) {
      await cp(join(ARTIFACT_ROOT, id), join(extDir, id), { recursive: true });
    }
    process.env.ZCC_EXTENSIONS_DIR = extDir;
    // Dynamic import (matches discovery-project-tab.test.ts): `getExtensionsDir`
    // reads the env at call time, so the value set above is honored.
    const { discoverExtensions, toEntry } = await import('../../discovery.js');
    const discovered = await discoverExtensions();
    const map = new Map<string, ExtensionEntry>();
    for (const d of discovered) map.set(d.id, toEntry(d));
    return map;
  } finally {
    if (prev === undefined) delete process.env.ZCC_EXTENSIONS_DIR;
    else process.env.ZCC_EXTENSIONS_DIR = prev;
    await rm(extDir, { recursive: true, force: true });
  }
}

/** Fetch a seeded entry or fail loudly (a missing artifact is a real drift). */
export function requireEntry(entries: Map<string, ExtensionEntry>, id: SeededId): ExtensionEntry {
  const e = entries.get(id);
  if (!e) throw new Error(`seeded extension "${id}" not discovered from ${ARTIFACT_ROOT}`);
  return e;
}
