import { describe, it, expect } from 'vitest';
// CROSS-IMPORT NOTE: this main-located conformance test imports the exported
// pure `scopeLines` from the RENDERER component `ExtensionConsent.tsx`. The repo
// typechecks as a SINGLE tsc program (tsconfig.json: one `include` spanning
// src/main + src/renderer, `moduleResolution: Bundler`, DOM lib + react-jsx), so
// a main→renderer type import resolves; vitest resolves it at runtime the same
// way the existing renderer-side `consent-scope-lines.test.ts` does. If the repo
// is ever split into per-surface tsconfig programs, move this file under
// src/renderer/**/__tests__/ (or import scopeLines from a shared module).
import { scopeLines } from '../../../../renderer/components/ExtensionConsent';
import { loadSeededEntries, requireEntry } from './seeded-manifests.js';

/**
 * CONSENT-SCOPELINES net (W1-8) — LIVE (W1-1/2/3 landed).
 *
 * The consent breadth lines the USER reads must be derived from the SAME built
 * artifact the broker enforces against. Snapshotting `scopeLines(entry)` over the
 * seeded artifacts closes the source↔artifact↔consent-copy loop: if a scope
 * widens on the artifact (e.g. an allowlist gains `"*"`), the human-facing copy
 * moves in lockstep and the snapshot reds. The wildcard→"⚠ ANY … (unrestricted)"
 * transform (never a bare `*`) is asserted directly.
 */
describe('W1-8 consent-scopelines — seeded built artifacts', () => {
  it('consensus renders its mcp scope in plain language (post file-drop→MCP migration)', async () => {
    // Consensus migrated its re-analysis record-back channel from a file-drop
    // (fs:read on ~/.zana/consensus-inbox) to zana MCP artifacts (commit
    // 1e9ea2f5b), so the manifest now declares `mcp`/mcpAllowlist:["zana"] and
    // NO fs scope. The consent copy must track that: an integration-server line,
    // and NO "Folders it may access" line.
    const entries = await loadSeededEntries();
    const lines = scopeLines(requireEntry(entries, 'consensus'));
    expect(lines).toContain('Integration servers it may use: zana');
    expect(lines.some((l) => l.startsWith('Folders it may access:'))).toBe(false);
    expect(lines).toMatchSnapshot();
  });

  it('zana scope lines are stable', async () => {
    const entries = await loadSeededEntries();
    expect(scopeLines(requireEntry(entries, 'zana'))).toMatchSnapshot();
  });

  it('no seeded artifact declares a wildcard scope today (breadth stays enumerated)', async () => {
    const entries = await loadSeededEntries();
    for (const [, entry] of entries) {
      for (const line of scopeLines(entry)) {
        // A wildcard would be rendered LOUD, never a bare `*`. Assert both:
        // no bare-`*` line leaks, and — since none is expected today — no
        // "⚠ ANY" line appears either. If a future artifact legitimately gains
        // one, update this expectation deliberately (it's a breadth increase).
        expect(line).not.toMatch(/: \*$/);
        expect(line).not.toContain('⚠ ANY');
      }
    }
  });
});
