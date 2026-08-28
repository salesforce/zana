import { describe, expect, it } from 'vitest';
import {
  approvalInteractionOutcomeSchema,
  experimental_recordProviderChildIo
} from './provider-bridge.js';

describe('provider-bridge facade', () => {
  it('exports approvalInteractionOutcomeSchema for provider host bundles', () => {
    expect(typeof approvalInteractionOutcomeSchema.parse).toBe('function');
    expect(approvalInteractionOutcomeSchema.safeParse({ payload: {}, resolution: {} }).success).toBe(false);
  });

  it('exports experimental_recordProviderChildIo for ACP host bundles', () => {
    expect(typeof experimental_recordProviderChildIo).toBe('function');
  });
});
