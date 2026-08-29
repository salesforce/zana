import { describe, it, expect } from 'vitest';
import { SDK_API_VERSION } from '@zana-ai/zcc-extension-sdk';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { loadSeededEntries, requireEntry, SEEDED_IDS } from './seeded-manifests.js';

/**
 * GOLDEN-MANIFEST net (W1-8) — LIVE (W1-1/2/3 landed).
 *
 * Snapshots the CAPABILITY CONTRACT of each seeded extension as it exists on the
 * shipped artifact (surface #2), driven through the real discovery pipeline.
 * This is the regression contract for the whole source→artifact→installed flow:
 * a permission/scope drift, an id/version/entry change, or a projectTab flip
 * shows up as a snapshot diff. Regenerate ONLY when the capability change was
 * intended (`vitest -u`), the same discipline as the golden-argv net.
 * First-party plugins (docs) live in `plugins/` and are not part of this net.
 *
 * The volatile `build` block (sha + timestamp, rewritten every package.mjs run)
 * is stripped before snapshotting so a rebuild alone never reds the net — the
 * contract is the capabilities, not the build stamp.
 */
function contractOf(entry: ExtensionEntry) {
  const m = entry.manifest;
  return {
    id: m?.id,
    title: m?.title,
    version: m?.version,
    entry: m?.entry,
    engines: m?.engines,
    permissions: m?.permissions,
    permissionScopes: m?.permissionScopes,
    projectTab: m?.projectTab,
    agentPreset: m?.agentPreset
  };
}

describe('W1-8 golden-manifest — seeded built artifacts', () => {
  it('discovers exactly the seeded extensions', async () => {
    const entries = await loadSeededEntries();
    expect([...entries.keys()].sort()).toEqual([...SEEDED_IDS].sort());
  });

  it('API contract version is unchanged (no major bump — additive-only Wave-1)', () => {
    // The lead's ruling: Wave-1 (emit + host.*) is additive; the SDK API stays
    // v1. A bump here means a breaking contract change slipped in — STOP.
    expect(SDK_API_VERSION).toBe(1);
    // Every seeded artifact still declares a v1-compatible engine range.
    // (Asserted per-id in the golden snapshot below via `engines`.)
  });

  for (const id of SEEDED_IDS) {
    it(`capability contract is stable — ${id}`, async () => {
      const entries = await loadSeededEntries();
      expect(contractOf(requireEntry(entries, id))).toMatchSnapshot();
    });
  }
});
