import { describe, it, expect } from 'vitest';
import { CORE_NAV_IDS } from '../store';

// Guards for two P1 fixes:
//  1. CORE_NAV_IDS drives the dangling-nav bounce in App.tsx — if a core nav id
//     is dropped from this set it would be treated as a dead module and bounce
//     home (regression), so pin the exact membership. `Set<CoreNavId>` already
//     rejects a non-core id at compile time; this pins the other direction
//     (every core destination is present).
describe('CORE_NAV_IDS', () => {
  it('contains exactly the built-in nav destinations', () => {
    expect([...CORE_NAV_IDS].sort()).toEqual(
      [
        'agents',
        'extensions',
        'followups',
        'goals',
        'home',
        'inbox',
        'library',
        'personas',
        'projects',
        'scheduler',
        'settings',
        'squads',
        'suggestions',
        'usage'
      ].sort()
    );
  });

  it('classifies a removed extension id as non-core (would bounce home)', () => {
    // The App.tsx guard bounces when nav is neither a core id nor a live module.
    expect(CORE_NAV_IDS.has('some-removed-extension' as never)).toBe(false);
  });
});
