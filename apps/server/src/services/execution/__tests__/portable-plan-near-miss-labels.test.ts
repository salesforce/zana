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
    ['Require', 'requires', 'Skills: `x`'],
    ['Depend on', 'depends on', '`b`'],
    ['Dependson', 'depends on', '`b`'],
    ['Exclude', 'excludes', '`x.md`']
  ])('folds %s onto %s and records it', (label, intended, value) => {
    const parsed = parsePortablePlan(plan(`- ${label}: ${value}`));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.normalizations).toContain(`step a label "${label.toLowerCase()}" treated as "${intended}"`);
  });

  it('keeps the value carried by a folded label', () => {
    const parsed = parsePortablePlan(plan('- Depend on: `b`'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.units[0].dependencies).toEqual(['b']);
  });

  it('folds a near-miss label that replaces the canonical one', () => {
    const parsed = parsePortablePlan('### a: A <!-- executable-step -->\n- Works: Do it.\n- Verification: v\n');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.units[0].task).toBe('Do it.');
      expect(parsed.normalizations).toEqual(['step a label "works" treated as "work"']);
    }
  });

  it('does not record a note for a canonical label or for "Requirements"', () => {
    const clean = parsePortablePlan(plan('- Requires: None'));
    expect(clean.ok && clean.normalizations).toBeUndefined();
    // "Requirements" is not within one edit of "requires"; it is plain text.
    const requirements = parsePortablePlan(plan('- Requirements: Skills: `x`'));
    expect(requirements.ok).toBe(true);
    if (requirements.ok) expect(requirements.normalizations).toBeUndefined();
  });

  it.each([
    ['Write scopes', 'write scope'],
    ['Writescope', 'write scope'],
    ['Verifications', 'verification'],
    ['Modes', 'mode'],
    ['Works', 'work']
  ])('fails when %s sits alongside the canonical label', (label, canonical) => {
    const parsed = parsePortablePlan(plan(`- ${label}: something`));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain('step a has conflicting labels');
      expect(parsed.reason).toContain(`(both read as "${canonical}")`);
    }
  });

  it.each(['Purpose / why', 'Notes', 'Note', 'Model', 'Steps', 'Outputs / handoff', 'Stop conditions', 'Completion criteria', 'Read scope', 'Requires'])(
    'accepts %s',
    (label) => {
      expect(parsePortablePlan(plan(`- ${label}: ${label === 'Requires' ? 'None' : 'something'}`)).ok).toBe(true);
    }
  );

  it('accepts a valid execution class and fails loudly on an unmapped one', () => {
    expect(parsePortablePlan(plan('- Execution class: Standard')).ok).toBe(true);
    const bad = parsePortablePlan(plan('- Execution class: something'));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toContain('could not pin minimumLevel for execution class "something"');
  });

  it('matches case-insensitively and in bare bold form', () => {
    const folded = parsePortablePlan(plan('**require:** None'));
    expect(folded.ok).toBe(true);
    if (folded.ok) expect(folded.normalizations).toEqual(['step a label "require" treated as "requires"']);
    expect(parsePortablePlan(plan('- **REQUIRES:** None')).ok).toBe(true);
  });
});
