import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { GrokProvider } from '../provider.js';

const config = { version: 1, theme: 'dark' } as AppConfig;
const provider = new GrokProvider();

describe('GrokProvider', () => {
  it('launches the TUI, continues, and auto-approves on the matching profiles', () => {
    expect(provider.resolveLaunch('grok', config, false)).toEqual({ command: 'grok', args: [] });
    expect(provider.resolveLaunch('grok-resume', config, false)).toEqual({
      command: 'grok',
      args: ['--continue']
    });
    expect(provider.resolveLaunch('grok-yolo', config, false)).toEqual({
      command: 'grok',
      args: ['--always-approve']
    });
    expect(provider.baseArgsPinSession('grok-resume')).toBe(true);
    expect(provider.baseArgsPinSession('grok')).toBe(false);
  });

  it('honors a configured grokBinary and injects --model', () => {
    expect(provider.resolveLaunch('grok', { ...config, grokBinary: '/opt/grok' }, false).command)
      .toBe('/opt/grok');
    expect(provider.modelContribution('grok-4.5')).toEqual({ args: ['--model', 'grok-4.5'] });
  });

  it('accepts catalog model ids that are not in the empty adapter snapshot', () => {
    expect(provider.acceptsUnlistedModelTargets).toBe(true);
  });

  it('maps portable Edits onto the native TUI with no extra flags', () => {
    expect(provider.adapter.descriptor.targets?.executionStateMapping).toEqual({
      interactive: 'default',
      'accept-edits': 'default'
    });
    expect(provider.executionContribution('grok.execution.interactive')).toEqual({});
    expect(provider.executionContribution('grok.execution.accept-edits')).toEqual({});
  });
});
