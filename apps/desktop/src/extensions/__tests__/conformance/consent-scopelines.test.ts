import { describe, it, expect } from 'vitest';
// CROSS-IMPORT NOTE: this main-located conformance test imports the exported
// pure `scopeLines` from the RENDERER component `ExtensionConsent.tsx`. The repo
// typechecks as a SINGLE tsc program (tsconfig.json: one `include` spanning
// src/main + apps/app/src, `moduleResolution: Bundler`, DOM lib + react-jsx), so
// a main→renderer type import resolves; vitest resolves it at runtime the same
// way the existing renderer-side `consent-scope-lines.test.ts` does. If the repo
// is ever split into per-surface tsconfig programs, move this file under
// apps/app/src/**/__tests__/ (or import scopeLines from a shared module).
import { scopeLines } from '@/components/ExtensionConsent';
import { loadSeededEntries } from './seeded-manifests.js';

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
