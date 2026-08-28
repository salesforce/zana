import { describe, expect, it } from 'vitest';
import { defaultAutonomousTeamId } from './autonomous-team-composer.js';

describe('defaultAutonomousTeamId', () => {
  it('keeps a still-listed selection and otherwise takes the first team', () => {
    const teams = [{ id: 'alpha' }, { id: 'beta' }];
    expect(defaultAutonomousTeamId(teams, 'beta')).toBe('beta');
    expect(defaultAutonomousTeamId(teams, 'gone')).toBe('alpha');
    expect(defaultAutonomousTeamId([], 'beta')).toBe('');
  });
});
