import { describe, it, expect } from 'vitest';
import { loadSeededEntries, requireEntry } from './seeded-manifests.js';

/**
 * MCP-ON-ARTIFACT DRIFT GUARD (W1-8) — LIVE (W1-1/2/3 landed).
 *
 * The direct W1-2 payoff, kept as its own file so it can't be buried in a wider
 * snapshot. W1-2's lesson: a capability change (here, the `mcp` permission +
 * `mcpAllowlist`) is only real once it lands on the REGISTERED BUILD ARTIFACT
 * (`bundled-extensions/<id>`), NOT the source manifest that never runs. This
 * guard asserts the `mcp` capability is present ON THE ARTIFACT for the
 * extensions that must carry it — so a future edit that touches only the source
 * manifest (leaving the artifact stale, the exact W1-2 bug) reds here.
 *
 * Ground truth: zana carries `mcp` + `mcpAllowlist:["zana"]`.
 */
describe('W1-8 mcp-on-artifact drift guard', () => {
  it('zana artifact carries mcp + mcpAllowlist=["zana"]', async () => {
    const entries = await loadSeededEntries();
    const zana = requireEntry(entries, 'zana');
    expect(zana.manifest?.permissions).toContain('mcp');
    expect(zana.manifest?.permissionScopes?.mcpAllowlist).toEqual(['zana']);
  });

  it('an extension declaring `mcp` also declares a non-empty mcpAllowlist', async () => {
    // Structural invariant: an mcp grant with no allowlist is a mis-scoped
    // capability (the broker would have nothing concrete to match). Holds for
    // every seeded artifact, and guards a future one from shipping mcp unscoped.
    const entries = await loadSeededEntries();
    for (const [id, entry] of entries) {
      if (entry.manifest?.permissions?.includes('mcp')) {
        const allow = entry.manifest?.permissionScopes?.mcpAllowlist;
        expect(allow && allow.length > 0, `${id} declares mcp but no mcpAllowlist`).toBe(true);
      }
    }
  });
});
