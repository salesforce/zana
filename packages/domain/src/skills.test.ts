import { describe, expect, it } from 'vitest';
import { isSkillState, SKILL_STATES } from './skills.js';

describe('public skill-state contract', () => {
  it('exports every supported state through the skills entry point', () => {
    expect(SKILL_STATES).toEqual(['on', 'manual', 'off']);
    for (const state of SKILL_STATES) expect(isSkillState(state)).toBe(true);
  });

  it.each([undefined, null, '', 'ON', 'disabled', false, 1, {}, []])('rejects unsupported state %j', value => {
    expect(isSkillState(value)).toBe(false);
  });
});
