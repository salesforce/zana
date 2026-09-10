import { describe, expect, it } from 'vitest';
import { isDurableCoordination } from './product.js';

describe('isDurableCoordination', () => {
  it('treats job-team, structured, and freeform as durable', () => {
    expect(isDurableCoordination('job-team')).toBe(true);
    expect(isDurableCoordination('structured')).toBe(true);
    expect(isDurableCoordination('freeform')).toBe(true);
  });

  it('treats interactive-team, autonomous-team, and undefined as not durable', () => {
    expect(isDurableCoordination('interactive-team')).toBe(false);
    expect(isDurableCoordination('autonomous-team')).toBe(false);
    expect(isDurableCoordination(undefined)).toBe(false);
  });
});
