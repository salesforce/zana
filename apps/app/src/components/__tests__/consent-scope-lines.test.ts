import { describe, it, expect } from 'vitest';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { scopeLines } from '../ExtensionConsent.js';

/**
 * The consent screen must render the `streamAllowlist` scope for the new
 * `stream` capability (SDK streaming epic S1/S4) so the user sees which live
 * feeds an extension may subscribe to — and, for the `"*"` wildcard, that the
 * breadth is UNRESTRICTED (⚠), never a bare `*`. Pure-function assertion over
 * the entry (no React render).
 */
function entryWithStreamAllowlist(streamAllowlist: string[]): ExtensionEntry {
  // Only permissionScopes is consulted by scopeLines; cast the minimal shape.
  return {
    manifest: { permissionScopes: { streamAllowlist } }
  } as unknown as ExtensionEntry;
}

describe('ExtensionConsent scopeLines — stream capability', () => {
  it('lists the concrete allowlisted feed handles', () => {
    const lines = scopeLines(entryWithStreamAllowlist(['service.events', 'zana:events']));
    expect(lines).toContain('Live feeds it may subscribe to: service.events, zana:events');
  });

  it('renders the "*" wildcard LOUD (⚠ ANY feed), never a bare *', () => {
    const lines = scopeLines(entryWithStreamAllowlist(['*']));
    const streamLine = lines.find((l) => l.startsWith('Live feeds'));
    expect(streamLine).toBe('Live feeds it may subscribe to: ⚠ ANY feed (unrestricted)');
    expect(streamLine).not.toMatch(/: \*$/);
  });

  it('emits no stream line when the allowlist is absent/empty', () => {
    expect(scopeLines(entryWithStreamAllowlist([])).some((l) => l.startsWith('Live feeds'))).toBe(
      false
    );
    expect(scopeLines({ manifest: {} } as unknown as ExtensionEntry)).toEqual([]);
  });
});
