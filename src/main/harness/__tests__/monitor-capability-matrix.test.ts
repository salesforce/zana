import { describe, expect, it } from 'vitest';
import { HARNESS_REGISTRATIONS } from '../registry.js';

describe('harness monitor capability matrix', () => {
  it('declares an honest monitor capability for every harness', () => {
    const matrix = new Map(HARNESS_REGISTRATIONS.map((registration) => [registration.id, registration.monitorCapability]));

    expect(matrix.get('claude')).toMatchObject({ state: 'supported' });
    expect(matrix.get('codex')).toMatchObject({ state: 'unsupported' });
    expect(matrix.get('opencode')).toMatchObject({ state: 'unsupported' });
    expect(matrix.get('cursor')).toMatchObject({ state: 'unsupported' });
    expect(matrix.get('pi')).toMatchObject({ state: 'unsupported' });

    for (const capability of matrix.values()) {
      if (capability.state === 'supported') expect(capability.sources.length).toBeGreaterThan(0);
      else expect(capability.reason).toBeTruthy();
    }
  });
});
