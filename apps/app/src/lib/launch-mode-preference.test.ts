import { afterEach, describe, expect, it } from 'vitest';
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
import { COMPOSER_LAUNCH_SURFACES_REV } from '@zana-ai/zcc-domain/product';

function installMemoryStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: (key) => { store.delete(key); },
    clear: () => store.clear(), key: () => null, length: 0
  } as Storage;
}

afterEach(() => {
  try { localStorage.removeItem(LAUNCH_MODE_PREF_KEY); } catch { /* node without localStorage */ }
});

describe('launch modes', () => {
  it('exposes one Team mode', () => {
    expect([...LAUNCH_MODES]).toEqual(['agent', 'thread', 'team']);
    expect(LAUNCH_MODE_PICKLIST_OPTIONS.map(({ label }) => label)).toEqual(['CLI Agent', 'Modern', 'Team']);
  });

  it('migrates stored autonomous and job preferences to Team', () => {
    expect(parseLaunchMode('autonomous')).toBe('team');
    expect(parseLaunchMode('job')).toBe('team');
    expect(parseLaunchMode('team')).toBe('team');
    expect(parseLaunchMode('unknown')).toBe(DEFAULT_LAUNCH_MODE);
    installMemoryStorage();
    localStorage.setItem(LAUNCH_MODE_PREF_KEY, 'autonomous');
    expect(readLaunchModePreference()).toBe('team');
    writeLaunchModePreference('team');
    expect(localStorage.getItem(LAUNCH_MODE_PREF_KEY)).toBe('team');
  });

  it('falls back from unavailable modes', () => {
    expect(resolveAvailableLaunchMode('team', { showTeam: false })).toBe('agent');
    expect(resolveAvailableLaunchMode('thread', { showTeam: false })).toBe('thread');
    expect(resolveAvailableLaunchMode('agent', { showCliAgent: false, showModern: true, showTeam: true })).toBe('thread');
  });
});

describe('composer surface flags', () => {
  it('folds legacy toggles into one default-on Team surface', () => {
    expect(composerSurfacesFromConfig({})).toEqual({ showCliAgent: true, showModern: true, showTeam: true });
    expect(composerSurfacesFromConfig({ composerShowAutonomousTeam: false, teamJobLaunchEnabled: true }).showTeam).toBe(true);
    expect(composerSurfacesFromConfig({ composerShowAutonomousTeam: true, teamJobLaunchEnabled: false }).showTeam).toBe(true);
    expect(composerSurfacesFromConfig({ composerShowAutonomousTeam: false, teamJobLaunchEnabled: false }).showTeam).toBe(false);
  });

  it('repairs a persisted both-off pair to all three on', () => {
    expect(composerSurfacesFromConfig({
      composerShowCliAgent: false,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false
    })).toEqual({ showCliAgent: true, showModern: true, showTeam: true });
  });

  it('resets leftover CLI-only until the launch-surface rev is persisted', () => {
    expect(composerSurfacesFromConfig({
      composerShowCliAgent: true,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false
    })).toEqual({ showCliAgent: true, showModern: true, showTeam: true });
    expect(composerSurfacesFromConfig({
      composerShowCliAgent: true,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false,
      composerLaunchSurfacesRev: COMPOSER_LAUNCH_SURFACES_REV
    })).toEqual({ showCliAgent: true, showModern: false, showTeam: false });
  });

  it('keeps one single-agent surface and hides Team until teams exist', () => {
    const normalized = normalizeComposerSurfaces({ showCliAgent: true, showModern: false, showTeam: true });
    expect(normalized).toEqual({ showCliAgent: true, showModern: false, showTeam: true });
    expect(canDisableComposerSurface('agent', normalized)).toBe(false);
    expect(visibleComposerLaunchModes(normalized, { hasTeams: false }).showTeam).toBe(false);
    expect(normalizeComposerSurfaces({ showCliAgent: false, showModern: false, showTeam: false }))
      .toEqual({ showCliAgent: true, showModern: true, showTeam: true });
  });

  it('writes both legacy config keys for persisted compatibility', () => {
    const flags = { showCliAgent: true, showModern: false, showTeam: false };
    expect(visibleLaunchModeCount(flags)).toBe(1);
    expect(launchModePicklistOptions(flags).map(({ value }) => value)).toEqual(['agent']);
    expect(composerSurfacesToConfigPatch(flags)).toEqual({
      composerShowCliAgent: true,
      composerShowModern: false,
      composerShowAutonomousTeam: false,
      teamJobLaunchEnabled: false
    });
  });
});
