import { describe, expect, it } from 'vitest';
import { shimLegacyExtensionManifest } from './legacy-shim.js';

function skillRoots(path: string): string[] | undefined {
  const shimmed = shimLegacyExtensionManifest(
    { id: 'demo', version: '1.0.0', entry: { main: 'server.js' }, skills: [{ path }] },
    'demo'
  );
  return shimmed.zcc.skills;
}

describe('legacy shim skill roots', () => {
  it('derives the skill root and ignores trailing slashes and backslashes', () => {
    expect(skillRoots('skills/a/SKILL.md')).toEqual(['skills']);
    expect(skillRoots('skills\\a\\SKILL.md///')).toEqual(['skills']);
    expect(skillRoots('skills/a/')).toEqual(['skills']);
  });

  it('is linear on a long run of slashes followed by another character', () => {
    // The old /\/+$/ restarted at every slash: quadratic on this shape.
    const started = performance.now();
    skillRoots(`a${'/'.repeat(100_000)}x`);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
