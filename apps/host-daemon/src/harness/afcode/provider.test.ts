import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { parseProfile, harnessFamilyOf, providerCapabilities, profileLabel } from '@zana-ai/zcc-domain/launch-provider';
import { AfcodeProvider } from './provider.js';
import { afcodeHarness } from './registration.js';
import { resolveModelTarget, resolveExecutionState } from '../target-resolution.js';

const config = { version: 1, shell: '/bin/sh' } as AppConfig;
const provider = new AfcodeProvider();

describe('afcode native launcher', () => {
  it.each([
    ['afcode', ['--local']],
    ['afcode-resume', ['--local', '--resume']],
    ['afcode-yolo', ['--local', '--auto-approve']]
  ] as const)('launches %s inside the owned PTY', (profile, args) => {
    expect(provider.resolveLaunch(profile, config, false)).toEqual({ command: 'afcode', args });
    expect(provider.title(profile)).toBe(['afcode', ...args].join(' '));
    expect(parseProfile(profile)).toBe(profile);
    expect(harnessFamilyOf(profile)).toBe('afcode');
    expect(profileLabel(profile)).toContain('afcode');
    expect(providerCapabilities(profile)).toMatchObject({ isAgent: true, acceptsPromptArgv: false, injectsClaudeMcpConfig: false, supportsHooks: false });
    expect(provider.baseArgsPinSession(profile)).toBe(profile === 'afcode-resume');
  });
  it('keeps explicit resume references intact, including unrestricted launches', () => {
    expect(provider.resolveLaunch('afcode-yolo', config, false, 'session with spaces').args)
      .toEqual(['--local', '--resume', 'session with spaces', '--auto-approve']);
  });
  it('honors canonical and compatibility executable settings', () => {
    expect(provider.resolveLaunch('afcode', { ...config, afcodeBinary: '/tmp/legacy' }, false).command).toBe('/tmp/legacy');
    expect(provider.resolveLaunch('afcode', { ...config, afcodeBinary: '/tmp/legacy', harnesses: {
      byId: { afcode: { binary: '/tmp/bin with spaces/afcode' } }
    } }, false).command).toBe('/tmp/bin with spaces/afcode');
  });
  it('rejects remote launch and exposes no CLI model picker', () => {
    expect(() => provider.buildRemoteCommand({ profile: 'afcode', config, remote: { host: 'host', remotePath: '/tmp' } }))
      .toThrow('local projects only');
    expect(provider.acceptsUnlistedModelTargets).toBe(false);
    expect(provider.adapter.descriptor.modelSelection).toBe('native-only');
    expect(provider.adapter.descriptor.initialTaskDelivery).toMatchObject({ local: 'stdin-after-ready', remote: 'unsupported' });
  });
  it('restores with an explicit id or a picker, never global latest', () => {
    expect(afcodeHarness.restoreProjection!({ session: { profile: 'afcode' }, extraArgs: ['--continue'] }))
      .toEqual({ profile: 'afcode-resume', extraArgs: undefined });
    expect(afcodeHarness.restoreProjection!({ session: { profile: 'afcode', nativeConversationId: 'native-1' } }))
      .toEqual({ profile: 'afcode-resume', extraArgs: undefined, resumeSessionId: 'native-1' });
    expect(afcodeHarness.nativeConversationResume!('native-1')).toEqual({ profile: 'afcode', resumeSessionId: 'native-1' });
    expect(afcodeHarness.nativeConversationResume!('')).toBeUndefined();
    expect(afcodeHarness.nativeConversationId!({ nativeConversationId: 'native-1' })).toBe('native-1');
    expect(() => afcodeHarness.renderRemoteCommand({ profile: 'afcode', config, remote: { host: 'host', remotePath: '/tmp' } })).toThrow();
  });
  it('ignores inherited and per-tab model targets for native-only adapters', () => {
    const input = { config, profile: 'afcode' as const, extraArgs: [] };
    expect(resolveModelTarget(provider, input).contribution).toEqual({});
    const routing = { schemaVersion: 1 as const, byAdapter: { afcode: { modelTargetId: 'unsupported-model' } } };
    expect(resolveModelTarget(provider, { ...input, perTabRouting: routing })).toMatchObject({
      source: 'native-default',
      structuredSelected: false,
      contribution: {}
    });
    expect(resolveModelTarget(provider, { ...input, config: { ...config, harnessRouting: routing } })).toMatchObject({
      source: 'native-default',
      structuredSelected: false,
      contribution: {}
    });
    for (const executionState of ['plan', 'autonomous'] as const) {
      expect(() => resolveExecutionState(provider, { ...input, perTabRouting: {
        schemaVersion: 1, byAdapter: { afcode: { executionState } }
      } })).toThrow(`does not support ${executionState} execution state`);
    }
    for (const executionState of ['interactive', 'accept-edits'] as const) {
      expect(resolveExecutionState(provider, { ...input, perTabRouting: {
        schemaVersion: 1, byAdapter: { afcode: { executionState } }
      } }).contribution).toEqual({});
    }
  });
});
