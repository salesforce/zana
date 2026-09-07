import { describe, expect, it } from 'vitest';
import {
  approvalInteractionOutcomeSchema,
  experimental_buildBridgeToolCallContent,
  experimental_planStepsPresentation,
  experimental_recordProviderChildIo,
  isApprovalInteractionOutcome,
  planStepsPresentation,
  userQuestionInteractionOutcomeSchema
} from './provider-bridge.js';

describe('provider-bridge facade', () => {
  it('exports approvalInteractionOutcomeSchema for provider host bundles', () => {
    expect(typeof approvalInteractionOutcomeSchema.parse).toBe('function');
    expect(approvalInteractionOutcomeSchema.safeParse({ payload: {}, resolution: {} }).success).toBe(false);
  });

  it('exports user-question and approval outcome helpers for Claude host bundles', () => {
    expect(typeof userQuestionInteractionOutcomeSchema.parse).toBe('function');
    expect(typeof isApprovalInteractionOutcome).toBe('function');
  });

  it('exports experimental_buildBridgeToolCallContent for MCP tool-proxy servers', () => {
    expect(experimental_buildBridgeToolCallContent({ content: 'OK' })).toEqual([
      { type: 'text', text: 'OK' }
    ]);
  });

  it('exports experimental_recordProviderChildIo for ACP host bundles', () => {
    expect(typeof experimental_recordProviderChildIo).toBe('function');
  });

  it('exports planStepsPresentation as the stable plan-steps helper', () => {
    expect(typeof planStepsPresentation).toBe('function');
    expect(experimental_planStepsPresentation).toBe(planStepsPresentation);
    expect(planStepsPresentation([{ step: 'Ship', status: 'active' }])).toMatchObject({
      label: { pending: 'Updating plan', completed: 'Updated plan' },
      icon: { glyph: 'ListTodo' },
      suppress: true,
      title: 'Ship'
    });
  });
});
