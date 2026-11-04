import { afterEach, describe, expect, it } from 'vitest';
import {
  permissionModeForLaunchProfile,
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
