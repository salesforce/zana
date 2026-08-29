import { describe, it, expect } from 'vitest';
import type { ExtensionEntry } from '@zana-ai/zcc-domain/product';
import { consentDelta } from '../ExtensionConsent.js';

/**
 * The `'widened'` re-prompt highlights the DELTA — only the permission tokens
 * the user hasn't approved yet — instead of reading as "re-approve everything".
 * Three shapes must be right: a first-time `'new'` prompt (all new), a token
 * widening (split), and a SCOPE-only widening (no new token → the "New
 * permissions" list must be suppressed rather than rendered empty). Pure delta
 * assertion, no React render.
 */
function entry(over: Partial<ExtensionEntry>): ExtensionEntry {
  return {
    id: 'x',
    manifest: { id: 'x', title: 'X', icon: 'Box', engines: { zccApi: '^1' }, entry: { renderer: 'r.js' } },
    ...over
  } as unknown as ExtensionEntry;
}

function withPerms(needsConsent: ExtensionEntry['needsConsent'], permissions: string[], consentedPermissions?: string[]): ExtensionEntry {
  return entry({
    needsConsent,
    consentedPermissions,
    manifest: {
      id: 'x',
      title: 'X',
      icon: 'Box',
      engines: { zccApi: '^1' },
      entry: { renderer: 'r.js' },
      permissions
    } as unknown as ExtensionEntry['manifest']
  });
}

describe('consentDelta', () => {
  it('treats every permission as new on a first-time (new) prompt', () => {
    const d = consentDelta(withPerms('new', ['storage', 'net']));
    expect(d.newPerms).toEqual(['storage', 'net']);
    expect(d.approvedPerms).toEqual([]);
    expect(d.scopeOnlyWiden).toBe(false);
  });

  it('splits new vs already-approved on a token widening', () => {
    const d = consentDelta(withPerms('widened', ['storage', 'net'], ['storage']));
    expect(d.newPerms).toEqual(['net']);
    expect(d.approvedPerms).toEqual(['storage']);
    expect(d.scopeOnlyWiden).toBe(false);
  });

  it('flags scopeOnlyWiden when all tokens are already approved (scope-only broadening)', () => {
    // needsConsent:'widened' fired for a broadened allowlist, but every declared
    // TOKEN was already approved — so there is no "new permission" to list.
    const d = consentDelta(withPerms('widened', ['exec', 'net'], ['exec', 'net']));
    expect(d.newPerms).toEqual([]);
    expect(d.approvedPerms).toEqual(['exec', 'net']);
    expect(d.scopeOnlyWiden).toBe(true);
  });

  it('falls back to treating all as new when the approved snapshot is absent (loud default)', () => {
    const d = consentDelta(withPerms('widened', ['storage', 'net'], undefined));
    expect(d.newPerms).toEqual(['storage', 'net']);
    expect(d.approvedPerms).toEqual([]);
    // Non-empty newPerms ⇒ not a scope-only widening.
    expect(d.scopeOnlyWiden).toBe(false);
  });
});
