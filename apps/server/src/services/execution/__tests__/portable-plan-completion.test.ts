import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';

const plan = (fields: string) => `### review: Review <!-- executable-step -->
- Work: Inspect changes.
${fields}`;

describe('portable plan deterministic completion', () => {
  it('preserves named checks as data, not task prose', () => {
    const text = plan('- Completion criteria: check:lint, check:_tests-2\n- On failure: retry review up to 2 with feedback');
    expect(parsePortablePlan(text)).toMatchObject({ ok: true, units: [{ task: 'Inspect changes.', checks: ['lint', '_tests-2'], onFailure: { kind: 'retry', stepId: 'review', maxRetries: 2 } }] });
    expect(parsePortablePlan(text)).toEqual(parsePortablePlan(text));
  });

  it.each(['File exists.', 'check:', 'check:2bad', 'check:a, prose', 'check:a,', ',check:a', 'check:a.b', 'check:a\n  More prose'])('moves free-text or malformed Completion criteria into Verification: %s', (value) => {
    const parsed = parsePortablePlan(plan(`- **Completion criteria:** ${value}`));
    expect(parsed).toMatchObject({ ok: true, units: [{ verification: [`Completion criteria: ${value.trim()}`] }], findings: [{ severity: 'warning' }] });
    if (parsed.ok) expect(parsed.units[0].checks).toBeUndefined();
  });

  it('drops an empty Completion criteria and still rejects duplicate check names', () => {
    expect(parsePortablePlan(plan('- **Completion criteria:** '))).toMatchObject({ ok: true, units: [{ task: 'Inspect changes.' }] });
    expect(parsePortablePlan(plan('- **Completion criteria:** check:a, check:a'))).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate') });
  });

  it.each(['check:tests', 'Cannot write.'])('keeps Stop conditions as non-enforced guidance in Work: %s', (value) => {
    const parsed = parsePortablePlan(plan(`- Stop conditions: ${value}`));
    expect(parsed).toMatchObject({ ok: true, units: [{ task: `Inspect changes.\n\nStop conditions (guidance, not enforced): ${value}` }] });
  });

  it.each(['', 'None'])('drops or keeps empty-ish Stop conditions %s', (value) => {
    const parsed = parsePortablePlan(plan(`- Stop conditions: ${value}`));
    expect(parsed.ok).toBe(true);
  });

  it('folds a near-miss completion label and keeps its prose as Verification', () => {
    expect(parsePortablePlan(plan('- Completion criterion: prose'))).toMatchObject({ ok: true, units: [{ verification: ['Completion criteria: prose'] }] });
  });

  it('rejects duplicate completion declarations instead of silently taking last', () => {
    expect(parsePortablePlan(plan('- Completion criteria: prose\n- Completion criteria: check:tests'))).toMatchObject({ ok: false, reason: expect.stringContaining('conflicting labels') });
  });

  it('keeps labels inside fenced Work examples inert', () => {
    const text = plan('  ```md\n  - Completion criteria: prose\n  - Stop conditions: example\n  ```\n- Completion criteria: check:tests');
    expect(parsePortablePlan(text)).toMatchObject({ ok: true, units: [{ checks: ['tests'], task: expect.stringContaining('Stop conditions: example') }] });
  });
});
