import { describe, expect, it, afterEach } from 'vitest';
import {
  DEFAULT_LAUNCH_MODE,
  LAUNCH_MODE_PICKLIST_OPTIONS,
  LAUNCH_MODE_PREF_KEY,
  LAUNCH_MODES,
  canDisableComposerSurface,
  composerSurfacesFromConfig,
  composerSurfacesToConfigPatch,
  launchModePicklistOptions,
  normalizeComposerSurfaces,
  parseLaunchMode,
  readLaunchModePreference,
  resolveAvailableLaunchMode,
  visibleComposerLaunchModes,
  visibleLaunchModeCount,
  writeLaunchModePreference
} from './launch-mode-preference.js';

function installMemoryStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: () => null,
    length: 0
  } as Storage;
  return store;
}

afterEach(() => {
  try {
    localStorage.removeItem(LAUNCH_MODE_PREF_KEY);
  } catch {
    /* node without localStorage */
  }
});

describe('LAUNCH_MODES', () => {
  it('lists CLI Agent before Modern in the composer and Settings picklist', () => {
    expect([...LAUNCH_MODES]).toEqual(['agent', 'thread', 'autonomous', 'job']);
    expect(LAUNCH_MODE_PICKLIST_OPTIONS.map((option) => option.label)).toEqual([
      'CLI Agent',
      'Modern',
      'Autonomous Team',
      'Job Team'
    ]);
  });
});

describe('parseLaunchMode', () => {
  it('accepts the four launch modes and falls back otherwise', () => {
    expect(parseLaunchMode('thread')).toBe('thread');
    expect(parseLaunchMode('agent')).toBe('agent');
    expect(parseLaunchMode('autonomous')).toBe('autonomous');
    expect(parseLaunchMode('job')).toBe('job');
    expect(parseLaunchMode(null)).toBe(DEFAULT_LAUNCH_MODE);
    expect(parseLaunchMode(undefined)).toBe(DEFAULT_LAUNCH_MODE);
    expect(parseLaunchMode('')).toBe(DEFAULT_LAUNCH_MODE);
    expect(parseLaunchMode('modern')).toBe(DEFAULT_LAUNCH_MODE);
    expect(parseLaunchMode('cli')).toBe(DEFAULT_LAUNCH_MODE);
  });
});

describe('launch-mode preference storage', () => {
  it('defaults to Modern when unset and round-trips stored modes', () => {
    installMemoryStorage();
    expect(readLaunchModePreference()).toBe('thread');
    writeLaunchModePreference('agent');
    expect(readLaunchModePreference()).toBe('agent');
    writeLaunchModePreference('job');
    expect(readLaunchModePreference()).toBe('job');
  });
});

describe('resolveAvailableLaunchMode', () => {
  it('keeps Modern and CLI Agent regardless of team availability', () => {
    expect(resolveAvailableLaunchMode('thread', {
      showAutonomousTeam: false,
      showJobTeam: false
    })).toBe('thread');
    expect(resolveAvailableLaunchMode('agent', {
      showAutonomousTeam: false,
      showJobTeam: false
    })).toBe('agent');
  });

  it('falls back to the first remaining surface when Autonomous or Job Team is hidden', () => {
    expect(resolveAvailableLaunchMode('autonomous', {
      showAutonomousTeam: false,
      showJobTeam: true
    })).toBe('agent');
    expect(resolveAvailableLaunchMode('job', {
      showAutonomousTeam: true,
      showJobTeam: false
    })).toBe('agent');
  });

  it('falls back to CLI Agent when Modern is hidden', () => {
    expect(resolveAvailableLaunchMode('thread', {
      showCliAgent: true,
      showModern: false,
      showAutonomousTeam: false,
      showJobTeam: false
    })).toBe('agent');
  });

  it('falls back to Modern when CLI Agent is hidden', () => {
    expect(resolveAvailableLaunchMode('agent', {
      showCliAgent: false,
      showModern: true,
      showAutonomousTeam: false,
      showJobTeam: false
    })).toBe('thread');
  });

  it('keeps Autonomous and Job Team when those surfaces are offered', () => {
    expect(resolveAvailableLaunchMode('autonomous', {
      showAutonomousTeam: true,
      showJobTeam: true
    })).toBe('autonomous');
    expect(resolveAvailableLaunchMode('job', {
      showAutonomousTeam: true,
      showJobTeam: true
    })).toBe('job');
  });
});

describe('composer surface flags', () => {
  it('defaults Modern, CLI Agent, and Autonomous Team on, Job Team off', () => {
    expect(composerSurfacesFromConfig({})).toEqual({
      showCliAgent: true,
      showModern: true,
      showAutonomousTeam: true,
      showJobTeam: false
    });
  });

  it('cannot hide both Modern and CLI Agent', () => {
    expect(normalizeComposerSurfaces({
      showCliAgent: false,
      showModern: false,
      showAutonomousTeam: true,
      showJobTeam: true
    })).toEqual({
      showCliAgent: true,
      showModern: false,
      showAutonomousTeam: true,
      showJobTeam: true
    });
    expect(canDisableComposerSurface('agent', {
      showCliAgent: true,
      showModern: false,
      showAutonomousTeam: true,
      showJobTeam: false
    })).toBe(false);
    expect(canDisableComposerSurface('thread', {
      showCliAgent: false,
      showModern: true,
      showAutonomousTeam: true,
      showJobTeam: false
    })).toBe(false);
    expect(canDisableComposerSurface('agent', {
      showCliAgent: true,
      showModern: true,
      showAutonomousTeam: true,
      showJobTeam: false
    })).toBe(true);
  });

  it('hides Autonomous and Job Team until teams exist', () => {
    expect(visibleComposerLaunchModes({
      showCliAgent: true,
      showModern: true,
      showAutonomousTeam: true,
      showJobTeam: true
    }, { hasTeams: false })).toEqual({
      showCliAgent: true,
      showModern: true,
      showAutonomousTeam: false,
      showJobTeam: false
    });
  });

  it('counts visible surfaces and filters the Settings picklist', () => {
    const onlyCli = {
      showCliAgent: true,
      showModern: false,
      showAutonomousTeam: false,
      showJobTeam: false
    };
    expect(visibleLaunchModeCount(onlyCli)).toBe(1);
    expect(launchModePicklistOptions(onlyCli).map((option) => option.value)).toEqual(['agent']);
    expect(composerSurfacesToConfigPatch(onlyCli)).toEqual({
      composerShowCliAgent: true,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false
    });
  });
});
