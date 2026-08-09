import { describe, it, expect } from 'vitest';
import { pickBestRelease, type RegistryIndex } from '../index.js';

// pickBestRelease selects, per id, the highest-version release that is
// API-compatible with the host (SDK_API_VERSION = 1). Pure, no I/O.
const idx = (releases: RegistryIndex['releases']): RegistryIndex => ({ schema: 1, releases });

describe('pickBestRelease', () => {
  it('returns the highest compatible version for the id', () => {
    const r = pickBestRelease(
      idx([
        { id: 'gus', version: '0.1.0', zccApi: '>=1 <2', url: 'u', sha256: 'h' },
        { id: 'gus', version: '0.3.0', zccApi: '>=1 <2', url: 'u', sha256: 'h' },
        { id: 'gus', version: '0.2.0', zccApi: '>=1 <2', url: 'u', sha256: 'h' }
      ]),
      'gus'
    );
    expect(r?.version).toBe('0.3.0');
  });

  it('ignores releases for other ids', () => {
    const r = pickBestRelease(
      idx([
        { id: 'cu', version: '9.0.0', zccApi: '>=1 <2', url: 'u', sha256: 'h' },
        { id: 'gus', version: '0.2.0', zccApi: '>=1 <2', url: 'u', sha256: 'h' }
      ]),
      'gus'
    );
    expect(r?.version).toBe('0.2.0');
  });

  it('skips API-incompatible releases even if higher-versioned', () => {
    const r = pickBestRelease(
      idx([
        { id: 'gus', version: '2.0.0', zccApi: '>=2', url: 'u', sha256: 'h' },
        { id: 'gus', version: '0.9.0', zccApi: '>=1 <2', url: 'u', sha256: 'h' }
      ]),
      'gus'
    );
    expect(r?.version).toBe('0.9.0');
  });

  it('returns null when nothing matches', () => {
    expect(pickBestRelease(idx([]), 'gus')).toBeNull();
    expect(
      pickBestRelease(idx([{ id: 'cu', version: '1.0.0', zccApi: '>=1 <2', url: 'u', sha256: 'h' }]), 'gus')
    ).toBeNull();
  });
});
