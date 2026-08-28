import { describe, expect, it } from 'vitest';
import { approvalInteractionOutcomeSchema } from './provider-bridge.js';

describe('provider-bridge facade', () => {
  it('exports approvalInteractionOutcomeSchema for provider host bundles', () => {
    expect(typeof approvalInteractionOutcomeSchema.parse).toBe('function');
    expect(approvalInteractionOutcomeSchema.safeParse({ payload: {}, resolution: {} }).success).toBe(false);
  });
});
