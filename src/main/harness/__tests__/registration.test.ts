import { describe, expect, it } from 'vitest';
import { VALID_PROFILES } from '../../../shared/launch-provider.js';
import { HARNESS_REGISTRATIONS, providerFor, registrationFor, renderRemoteCommand } from '../registry.js';
import type { AppConfig, ProjectRemote } from '../../../shared/types.js';

const config: AppConfig = {
  version: 1,
  theme: 'dark',
  shell: '/bin/zsh',
  claudeBinary: 'claude',
  fontSize: 13,
  lastProjectId: null
};
const remote: ProjectRemote = { host: 'example.test', remotePath: '/workspace' };

describe('harness registrations', () => {
  it('owns each canonical profile exactly once', () => {
    const registeredProfiles = HARNESS_REGISTRATIONS.flatMap((registration) =>
      registration.profiles.map((profile) => profile.id)
    );
    expect(registeredProfiles).toEqual([...VALID_PROFILES]);
    expect(new Set(registeredProfiles).size).toBe(registeredProfiles.length);
  });

  it('projects profile ownership through the compatibility provider lookup', () => {
    for (const profile of VALID_PROFILES) {
      const registration = registrationFor(profile);
      expect(registration, `registration missing for ${profile}`).toBeDefined();
      expect(providerFor(profile)).toBe(registration!.implementation);
    }
  });

  it('keeps binary verification next to every non-shell registration', () => {
    for (const registration of HARNESS_REGISTRATIONS) {
      if (registration.id === 'shell') {
        expect(registration.verification).toBeUndefined();
      } else {
        expect(registration.verification?.versionArgs).toEqual(['--version']);
        expect(registration.verification?.installHint).not.toBe('');
      }
    }
  });

  it('routes remote command rendering through the owning registration', () => {
    for (const registration of HARNESS_REGISTRATIONS) {
      const profile = registration.defaultProfileId ?? registration.profiles[0].id;
      const input = { profile, config, remote };
      expect(renderRemoteCommand(profile, input)).toEqual(registration.renderRemoteCommand(input));
    }
  });

  it('keeps exact native resume projections with the owning registrations', () => {
    expect(registrationFor('claude')?.nativeConversationResume?.('claude-native')).toEqual({
      profile: 'claude', extraArgs: ['--resume', 'claude-native']
    });
    expect(registrationFor('codex')?.nativeConversationResume?.('codex-native')).toEqual({
      profile: 'codex-resume', resumeSessionId: 'codex-native'
    });
    expect(registrationFor('opencode')?.nativeConversationResume?.('opencode-native')).toEqual({
      profile: 'opencode-resume', resumeSessionId: 'opencode-native'
    });
  });

  it('owns restore projections and persisted native-session field mappings', () => {
    expect(registrationFor('claude')?.restoreProjection?.({
      session: { profile: 'claude', claudeSessionId: 'claude-native' },
      extraArgs: ['--continue', '--resume', 'old-native', '--model', 'opus']
    })).toEqual({
      profile: 'claude',
      extraArgs: ['--model', 'opus', '--resume', 'claude-native']
    });
    expect(registrationFor('codex')?.restoreProjection?.({
      session: { profile: 'codex', codexSessionId: 'codex-native' },
      extraArgs: ['--model', 'gpt-5.6']
    })).toEqual({
      profile: 'codex-resume',
      extraArgs: ['--model', 'gpt-5.6'],
      resumeSessionId: 'codex-native'
    });
    expect(registrationFor('codex')?.nativeSessionPatch?.('codex-native')).toEqual({
      kind: 'codex', codexSessionId: 'codex-native'
    });
    expect(registrationFor('opencode')?.nativeSessionPatch?.('opencode-native')).toEqual({
      kind: 'opencode', openCodeSessionId: 'opencode-native'
    });
  });

  it('keeps dynamic agent discovery with the owning OpenCode registration', () => {
    const openCode = registrationFor('opencode');
    expect(openCode?.discoverAgentDescriptors).toBeDefined();
    expect(registrationFor('opencode-resume')).toBe(openCode);
    expect(registrationFor('claude')?.discoverAgentDescriptors).toBeUndefined();
  });

  it('keeps Claude lifecycle policy and native encoding in its registration', () => {
    const lifecycle = registrationFor('claude')?.renderLifecycle?.({
      profile: 'claude',
      caps: providerFor('claude').capabilities('claude'),
      config,
      scheduled: false,
      headless: false,
      autoModeActive: false,
      callbacks: {
        stop: 'http://127.0.0.1/hook/stop/project/session',
        notify: 'http://127.0.0.1/hook/notify/project/session',
        firstPrompt: 'http://127.0.0.1/hook/firstprompt/project/session',
        subagent: 'http://127.0.0.1/hook/subagent/project/session',
        toolActivity: 'http://127.0.0.1/hook/toolactivity/project/session'
      },
      scope: 'local'
    });
    expect(lifecycle?.args[0]).toBe('--settings');
    expect(lifecycle?.env).toMatchObject({
      ZCC_HOOK_URL: 'http://127.0.0.1/hook/stop/project/session',
      ZCC_TOOLACTIVITY_URL: 'http://127.0.0.1/hook/toolactivity/project/session'
    });
  });
});
