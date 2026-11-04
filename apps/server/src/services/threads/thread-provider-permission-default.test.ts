import { afterEach, describe, expect, it } from 'vitest';
import {
  permissionModeForLaunchProfile,
  personaEffortForProvider,
  registerThreadProvider
} from './thread-provider-catalog.js';

const registrations: Array<{ unregister(): void }> = [];

function register(permissionModes: string[], id = 'permission-default-test') {
  registrations.push(registerThreadProvider('permission-default-test', {
    id,
    displayName: 'Permission default test',
    capabilities: { supportsServiceTier: false, fork: 'none', permissionModes }
  }));
  return id;
}

afterEach(() => {
  for (const registration of registrations.splice(0)) registration.unregister();
});

describe('permissionModeForLaunchProfile', () => {
  it.each([
    { modes: ['full'], expected: 'full' },
    { modes: ['auto'], expected: 'auto' },
    { modes: ['full', 'auto'], expected: 'auto' },
    { modes: ['full', 'auto', 'accept-edits'], expected: 'accept-edits' },
    { modes: ['accept-edits'], expected: 'accept-edits' }
  ])('defaults to the least privileged supported mode in $modes', ({ modes, expected }) => {
    expect(permissionModeForLaunchProfile(register(modes))).toBe(expected);
  });

  it('resolves the provider declaration through a launch-profile alias', () => {
    register(['full'], 'acp-opencode');
    expect(permissionModeForLaunchProfile('opencode')).toBe('full');
    expect(permissionModeForLaunchProfile('opencode-resume')).toBe('full');
  });

  it.each(['claude-yolo', 'opencode-yolo', 'grok-yolo', 'mastracode-yolo', 'afcode-yolo'])(
    'preserves the explicit Full intent of %s', (profile) => {
      expect(permissionModeForLaunchProfile(profile)).toBe('full');
    }
  );

  it('preserves the default for an unregistered provider', () => {
    expect(permissionModeForLaunchProfile('unregistered-provider')).toBe('accept-edits');
  });

  it.each([{ modes: [] }, { modes: ['unknown-mode'] }])('keeps the conservative fallback for invalid modes $modes', ({ modes }) => {
    expect(permissionModeForLaunchProfile(register(modes))).toBe('accept-edits');
  });
});

describe('personaEffortForProvider', () => {
  function registerProvider(id: string, reasoningLevels?: string[]) {
    registrations.push(registerThreadProvider('effort-test', {
      id, displayName: id, capabilities: { supportsServiceTier: false, fork: 'none', permissionModes: ['full'], ...(reasoningLevels ? { reasoningLevels } : {}) }
    }));
  }

  it('keeps a declared level on the Claude provider (including the claude alias)', () => {
    registerProvider('claude-code', ['low', 'medium', 'high', 'xhigh', 'max']);
    expect(personaEffortForProvider('claude-code', 'xhigh')).toBe('xhigh');
    expect(personaEffortForProvider('claude', 'max')).toBe('max');
  });

  it('drops an absent level and an unknown level', () => {
    registerProvider('claude-code', ['low', 'medium']);
    expect(personaEffortForProvider('claude-code', undefined)).toBeUndefined();
    expect(personaEffortForProvider('claude-code', 'turbo')).toBeUndefined();
    expect(personaEffortForProvider('claude-code', 'max')).toBe('medium');
  });

  it('keeps a declared level on any provider, not only Claude', () => {
    registerProvider('acp-opencode', ['low', 'medium', 'high', 'xhigh', 'max']);
    registerProvider('codex', ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    expect(personaEffortForProvider('acp-opencode', 'high')).toBe('high');
    expect(personaEffortForProvider('codex', 'max')).toBe('max');
  });

  it('steps an undeclared level down to the highest declared level below it', () => {
    registerProvider('acp-grok', ['low', 'medium', 'high']);
    expect(personaEffortForProvider('acp-grok', 'max')).toBe('high');
    expect(personaEffortForProvider('acp-grok', 'xhigh')).toBe('high');
    registerProvider('sparse', ['low', 'high']);
    expect(personaEffortForProvider('sparse', 'medium')).toBe('low');
  });

  it('gives none when nothing is declared at or below the level, or the provider is unknown', () => {
    registerProvider('claude-code');
    expect(personaEffortForProvider('claude-code', 'high')).toBeUndefined();
    registerProvider('acp-mastracode', []);
    expect(personaEffortForProvider('acp-mastracode', 'high')).toBeUndefined();
    registerProvider('high-only', ['high']);
    expect(personaEffortForProvider('high-only', 'low')).toBeUndefined();
    expect(personaEffortForProvider('nope', 'high')).toBeUndefined();
  });
});
