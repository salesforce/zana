import { describe, expect, it } from 'vitest';
import { defaultAutonomousTeamId } from './autonomous-team-composer.js';

describe('defaultAutonomousTeamId', () => {
  it('keeps a still-listed selection', () => {
    const teams = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'Alpha' }];
    expect(defaultAutonomousTeamId(teams, 'b')).toBe('b');
  });

  it('falls back to the first team alphabetically when none is flagged', () => {
    const teams = [{ id: 'b', name: 'Beta' }, { id: 'a', name: 'alpha' }];
    expect(defaultAutonomousTeamId(teams, 'gone')).toBe('a');
    expect(defaultAutonomousTeamId(teams, '')).toBe('a');
    expect(defaultAutonomousTeamId([], 'beta')).toBe('');
  });

  it('prefers the flagged default over alphabetical order', () => {
    const teams = [{ id: 'a', name: 'Alpha' }, { id: 'z', name: 'Zed', isDefault: true }];
    expect(defaultAutonomousTeamId(teams, 'gone')).toBe('z');
  });

  it('picks the alphabetically first when several are flagged', () => {
    const teams = [
      { id: 'z', name: 'Zed', isDefault: true },
      { id: 'm', name: 'Mid', isDefault: true },
      { id: 'a', name: 'Alpha' }
    ];
    expect(defaultAutonomousTeamId(teams, 'gone')).toBe('m');
  });
});
