import { describe, expect, it } from 'vitest';
import { HARNESS_FAMILIES_WITH_NATIVE_HISTORY } from '@zana-ai/zcc-domain/launch-provider';
import { HARNESS_REGISTRATIONS } from '../registry.js';

describe('native History capability stays in sync with the renderer constant', () => {
  it('lists exactly the harnesses that register a History adapter', () => {
    const withAdapter = HARNESS_REGISTRATIONS.filter((r) => r.createHistoryAdapter)
      .map((r) => r.id)
      .sort();
    expect([...HARNESS_FAMILIES_WITH_NATIVE_HISTORY].sort()).toEqual(withAdapter);
  });
});
