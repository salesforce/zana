import { describe, expect, it } from 'vitest';
import {
  approvalInteractionOutcomeSchema,
  experimental_buildBridgeToolCallContent,
  experimental_planStepsPresentation,
  experimental_recordProviderChildIo,
  experimental_runPortableCommand,
  experimental_spawnPortablePipedProcess,
  experimental_spawnPortableProcess,
  isApprovalInteractionOutcome,
  planStepsPresentation,
  userQuestionInteractionOutcomeSchema
} from './provider-bridge.js';

describe('provider-bridge facade', () => {
  it('lets provider hosts run bounded probes through the public SDK', async () => {
    const result = await experimental_runPortableCommand(process.execPath,
      ['-e', 'process.stdout.write("x".repeat(16000));process.stderr.write("diagnostic")'],
      { timeout: 5000 });
    expect(result).toEqual({ stdout: 'x'.repeat(16000), stderr: 'diagnostic' });
    expect(typeof experimental_spawnPortablePipedProcess).toBe('function');
    expect(typeof experimental_spawnPortableProcess).toBe('function');
  });
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
