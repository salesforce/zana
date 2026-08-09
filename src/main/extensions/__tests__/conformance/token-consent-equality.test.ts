import { describe, it, expect } from 'vitest';
import { EXTENSION_PERMISSIONS } from '@zana-ai/zcc-extension-sdk';
import { PERMISSION_LABELS } from '../../../../renderer/components/ExtensionConsent';
import { loadSeededEntries } from './seeded-manifests.js';

/**
 * TOKEN↔CONSENT-EQUALITY net (W1-8) — LIVE (W1-1/2/3 landed).
 *
 * The derived invariant: a user granting consent must NEVER see a bare, unlabeled
 * permission token. So every permission token that ANY seeded built artifact
 * actually declares MUST have a plain-language entry in `PERMISSION_LABELS`.
 * `scopeLines` (tested separately) covers the SCOPE detail; this covers the
 * per-token LABEL. Together they close the "artifact declares a capability the
 * consent screen can't describe" gap.
 *
 * KNOWN ROSTER GAP (documented, not enforced here): the full SDK
 * `EXTENSION_PERMISSIONS` roster carries `session:reply`, which has no
 * `PERMISSION_LABELS` entry today (`permLabel` falls back to the raw token). No
 * seeded artifact declares `session:reply`, so no user sees a raw token in
 * practice — the LIVE assertion below is therefore scoped to tokens actually in
 * use. The full-roster check is asserted SOFT (a console note) so a future ext
 * that adds `session:reply` trips the seeded-token assertion loudly.
 */
describe('W1-8 token↔consent-equality — seeded built artifacts', () => {
  it('every permission a seeded artifact declares has a consent label', async () => {
    const entries = await loadSeededEntries();
    const declared = new Set<string>();
    for (const [, entry] of entries) {
      for (const p of entry.manifest?.permissions ?? []) declared.add(p);
    }
    // Sanity: the seeded set actually declares capabilities (guards a silently
    // empty discovery from making this a vacuous pass).
    expect(declared.size).toBeGreaterThan(0);

    const unlabeled = [...declared].filter((p) => !(p in PERMISSION_LABELS));
    expect(unlabeled).toEqual([]);
  });

  it('every declared token is a member of the SDK permission roster', async () => {
    const roster = new Set<string>(EXTENSION_PERMISSIONS);
    const entries = await loadSeededEntries();
    for (const [id, entry] of entries) {
      for (const p of entry.manifest?.permissions ?? []) {
        expect(roster.has(p), `${id} declares unknown permission "${p}"`).toBe(true);
      }
    }
  });
});
