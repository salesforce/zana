import { describe, expect, it, vi } from 'vitest';
import { runStartupDependencyDoctor } from './startup-dependency-doctor.js';

describe('runStartupDependencyDoctor', () => {
  it('skips installed provider probes during isolated E2E startup', () => {
    const check = vi.fn().mockResolvedValue(undefined);
    runStartupDependencyDoctor(true, check, vi.fn());
    expect(check).not.toHaveBeenCalled();
  });

  it('runs and reports startup dependency failures outside E2E', async () => {
    const error = new Error('probe failed');
    const onError = vi.fn();
    runStartupDependencyDoctor(false, vi.fn().mockRejectedValue(error), onError);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });
});
