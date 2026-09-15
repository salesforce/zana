import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { MastracodeProvider } from '../provider.js';

const config = { version: 1, theme: 'dark' } as AppConfig;
const provider = new MastracodeProvider();

describe('MastracodeProvider', () => {
  it('launches the TUI, continues, and sets YOLO env on the matching profiles', () => {
    expect(provider.resolveLaunch('mastracode', config, false)).toEqual({
      command: 'mastracode',
      args: []
    });
    expect(provider.resolveLaunch('mastracode-resume', config, false)).toEqual({
      command: 'mastracode',
      args: ['--continue']
    });
    expect(provider.resolveLaunch('mastracode-yolo', config, false)).toEqual({
      command: 'mastracode',
      args: [],
      env: { MASTRACODE_YOLO: '1' }
    });
    expect(provider.baseArgsPinSession('mastracode-resume')).toBe(true);
    expect(provider.baseArgsPinSession('mastracode')).toBe(false);
  });

  it('delivers the CLI Agent opening task via stdin after the TUI is ready', () => {
    expect(provider.adapter.descriptor.initialTaskDelivery).toEqual({
      local: 'stdin-after-ready',
      remote: 'stdin-after-ready',
      readinessSignal: 'provider-ready',
      acceptanceSignal: 'delivery-attempted'
    });
  });

  it('honors a configured mastracodeBinary and injects --model', () => {
    expect(provider.resolveLaunch('mastracode', { ...config, mastracodeBinary: '/opt/mastracode' }, false).command)
      .toBe('/opt/mastracode');
    expect(provider.modelContribution('anthropic/claude-opus-4-6')).toEqual({
      args: ['--model', 'anthropic/claude-opus-4-6']
    });
  });

  it('accepts catalog model ids that are not in the empty adapter snapshot', () => {
    expect(provider.acceptsUnlistedModelTargets).toBe(true);
  });

  it('maps portable Edits onto the native TUI with no extra flags', () => {
    expect(provider.adapter.descriptor.targets?.executionStateMapping).toEqual({
      interactive: 'default',
      'accept-edits': 'default'
    });
    expect(provider.executionContribution('mastracode.execution.interactive')).toEqual({});
    expect(provider.executionContribution('mastracode.execution.accept-edits')).toEqual({});
  });

  it('prefixes remote yolo with MASTRACODE_YOLO', () => {
    const remote = provider.buildRemoteCommand({
      profile: 'mastracode-yolo',
      config,
      extraArgs: [],
      remote: { host: 'example.test', remotePath: '/workspace' }
    });
    expect(remote.cmd).toContain('env MASTRACODE_YOLO=1 exec');
    expect(remote.cmd).toContain('mastracode');
  });
});
