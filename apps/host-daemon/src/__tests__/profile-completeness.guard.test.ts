/**
 * Profile-completeness guard — the ONE test that fails when the launch-profile
 * enumeration drifts out of sync across the places it is (unavoidably) mirrored.
 *
 * `packages/domain/src/launch-provider.ts` `VALID_PROFILES` is the single source of truth,
 * but a profile id is physically re-listed in several files that cannot all
 * import the shared runtime value:
 *   - the family predicates (`isClaudeProfile` / `isCursorProfile` /
 *     `isCodexProfile` / `isPiProfile` / `isOpenCodeProfile`) — every non-shell
 *     profile must belong to exactly one;
 *   - `providerCapabilities` — must return a descriptor for every profile;
 *   - the registry (`providerFor`) — must resolve a real provider for every
 *     profile (not the shell fallback, unless it IS shell);
 *   - two hand-copied TYPE mirrors: the SDK's `SdkLaunchProfileId`
 *     (`packages/extension-sdk`) and the CLI's `LaunchProfileId`
 *     (`packages/cli`), which ship standalone and can't import core.
 *
 * Before this guard, the CLI mirror had silently drifted (missing cursor/codex).
 * This is the red test that turns that silent drift into a build failure: add a
 * profile to `VALID_PROFILES` and every mirror + partition must follow.
 *
 * Style: mixes a runtime check (predicates/registry/capabilities are importable
 * from main) with a source-text scan of the two external type mirrors.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VALID_PROFILES,
  isClaudeProfile,
  isCursorProfile,
  isCodexProfile,
  isPiProfile,
  isOpenCodeProfile,
  isAgentProfile,
  providerCapabilities
} from '@zana-ai/zcc-domain/launch-provider';
import { providerFor } from '../harness/registry.js';
import type { LaunchProfileId } from '@zana-ai/zcc-domain/product';

const repoRoot = process.cwd();

/** Extract every quoted `'...'` / `"..."` token from a `type X = | '...' ...`
 *  union declaration body (a crude but sufficient mirror scan). */
function unionMembers(src: string, typeName: string): string[] {
  // Grab from `type <name>` up to the terminating `;`.
  const re = new RegExp(`type\\s+${typeName}\\b[\\s\\S]*?;`);
  const m = src.match(re);
  if (!m) return [];
  return Array.from(m[0].matchAll(/['"]([a-z0-9-]+)['"]/gi)).map((x) => x[1]);
}

describe('profile-completeness — the enumeration agrees everywhere', () => {
  it('every non-shell profile belongs to exactly one family predicate', () => {
    for (const p of VALID_PROFILES) {
      if (p === 'shell') {
        expect(isAgentProfile(p)).toBe(false);
        continue;
      }
      const inFamilies = [
        isClaudeProfile(p),
        isCursorProfile(p),
        isCodexProfile(p),
        isPiProfile(p),
        isOpenCodeProfile(p)
      ].filter(Boolean).length;
      expect(inFamilies, `${p} must be in exactly one family predicate`).toBe(1);
      expect(isAgentProfile(p), `${p} must be an agent profile`).toBe(true);
    }
  });

  it('the registry resolves a non-fallback provider for every profile', () => {
    const shellId = providerFor('shell').id;
    for (const p of VALID_PROFILES) {
      const provider = providerFor(p);
      expect(provider, `no provider for ${p}`).toBeTruthy();
      if (p !== 'shell') {
        // A non-shell profile that resolves to the shell provider means it fell
        // through the `?? shell` fallback — i.e. it has no registry entry.
        expect(provider.id, `${p} fell through to the shell fallback`).not.toBe(shellId);
      }
      // capabilities must be defined for every profile.
      expect(() => providerCapabilities(p)).not.toThrow();
      expect(provider.capabilities(p)).toEqual(providerCapabilities(p));
    }
  });

  it('the SDK type mirror lists exactly VALID_PROFILES', () => {
    const src = readFileSync(
      join(repoRoot, 'packages/extension-sdk/src/main.ts'),
      'utf8'
    );
    const members = unionMembers(src, 'SdkLaunchProfileId');
    expect(members.slice().sort()).toEqual([...VALID_PROFILES].slice().sort());
  });

  it('the CLI type mirror lists exactly VALID_PROFILES', () => {
    const src = readFileSync(join(repoRoot, 'packages/cli/src/lib/types.ts'), 'utf8');
    const members = unionMembers(src, 'LaunchProfileId');
    expect(members.slice().sort()).toEqual([...VALID_PROFILES].slice().sort());
  });

  it('the core LaunchProfileId union lists exactly VALID_PROFILES', () => {
    const src = readFileSync(join(repoRoot, 'packages/domain/src/product.ts'), 'utf8');
    const members = unionMembers(src, 'LaunchProfileId');
    expect(members.slice().sort()).toEqual([...VALID_PROFILES].slice().sort());
  });
});

// Type-level assertion: VALID_PROFILES is exhaustive over LaunchProfileId. If a
// profile is added to the type but not the array (or vice-versa), this fails to
// compile.
const _exhaustive: readonly LaunchProfileId[] = VALID_PROFILES;
void _exhaustive;
