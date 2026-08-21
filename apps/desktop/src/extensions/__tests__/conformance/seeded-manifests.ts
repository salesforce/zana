/**
 * Shared fixture loader for the Wave-1 conformance net.
 *
 * ONE place the seeded-extension roster lives (surface #2 — the BUILT ARTIFACT
 * electron-builder used to pack as `extensions/` for `discoverExtensions` to
 * reseed). The W1-2 lesson: a capability/manifest change is only real once it
 * lands on the shipped artifact, not a source `extension.json` that never runs.
 * So the net drives the REAL discovery pipeline (`validateManifest` →
 * `toManifestView`, both private, run inside the exported `discoverExtensions`)
 * against a temp `ZCC_EXTENSIONS_DIR` seeded from the artifact — zero source edits.
 *
 * First-party plugins now live in `plugins/` (docs auto-installs from
 * `plugins/docs` via PluginService). This net currently snapshots zero
 * disk-extension artifacts (docs uses `package.json` `zcc`, not
 * `extension.json`, so discovery's extension.json scanner does not see it).
 */
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';

/** The ids seeded into the packaged app via extension.json artifacts. */
export const SEEDED_IDS = [] as const;
export type SeededId = (typeof SEEDED_IDS)[number];

/**
 * Repo root, derived from this file's location:
 * `apps/desktop/src/extensions/__tests__/conformance/` → six parents up.
 */
const CONFORMANCE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(CONFORMANCE_DIR, '../../../../../../');

/** Unused while SEEDED_IDS is empty — first-party plugins live in `plugins/`. */
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
