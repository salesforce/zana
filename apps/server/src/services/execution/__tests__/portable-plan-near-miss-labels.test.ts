import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';

const plan = (extra: string) => `### a: A <!-- executable-step -->
- Mode: Mutating
- Work: Do it.
- Write scope: \`out.md\`
- Verification: Read it.
${extra}
`;

describe('portable plan near-miss labels', () => {
  it.each([
    ['Require', 'requires'],
    ['Requirements', 'requires'],
    ['Depend on', 'depends on'],
    ['Dependson', 'depends on'],
    ['Write scopes', 'write scope'],
    ['Writescope', 'write scope'],
    ['Exclude', 'excludes'],
    ['Verifications', 'verification'],
    ['Modes', 'mode'],
    ['Works', 'work']
  ])('rejects %s', (label, intended) => {
    const parsed = parsePortablePlan(plan(`- ${label}: Skills: \`x\``));
    // "Requirements" is not within one edit of "requires"; it must stay accepted.
    if (label === 'Requirements') return expect(parsed.ok).toBe(true);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain(`did you mean "${intended}"?`);
  });

  it.each(['Purpose / why', 'Notes', 'Note', 'Model', 'Steps', 'Outputs / handoff', 'Stop conditions', 'Completion criteria', 'Read scope', 'Execution class', 'Requires'])(
    'accepts %s',
    (label) => {
      expect(parsePortablePlan(plan(`- ${label}: ${label === 'Requires' ? 'None' : 'something'}`)).ok).toBe(true);
    }
  );

  it('matches case-insensitively and in bare bold form', () => {
    expect(parsePortablePlan(plan('**require:** None')).ok).toBe(false);
    expect(parsePortablePlan(plan('- **REQUIRES:** None')).ok).toBe(true);
  });
});
