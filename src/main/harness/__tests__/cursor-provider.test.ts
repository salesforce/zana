import { describe, expect, it } from 'vitest';
import { CursorProvider } from '../cursor-provider.js';

describe('CursorProvider model routing', () => {
  const provider = new CursorProvider();

  it('exposes current account models and emits Cursor model argv', () => {
    expect(provider.adapter.descriptor.targets?.models.map((model) => model.id)).toEqual([
      'cursor-grok-4.5-high',
      'claude-opus-5-high',
      'gpt-5.6-sol-medium',
      'claude-sonnet-5-high',
      'gpt-5.6-terra-medium',
      'claude-4.5-opus-high',
      'claude-4.5-sonnet'
    ]);
    expect(provider.modelContribution('claude-sonnet-5-high')).toEqual({
      args: ['--model', 'claude-sonnet-5-high']
    });
    expect(provider.adapter.descriptor.targets?.modelLevelMapping).toEqual({
      low: undefined,
      medium: 'gpt-5.6-terra-medium',
      high: 'gpt-5.6-sol-medium',
      'extra-high': undefined
    });
  });

  it('declares approved global execution-state mappings', () => {
    expect(provider.adapter.descriptor.targets?.executionStateMapping).toEqual({
      plan: 'plan',
      interactive: 'default',
      'accept-edits': 'force',
      autonomous: 'force'
    });
  });
});
