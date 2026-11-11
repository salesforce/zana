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

  it.each(['File exists.', '', 'check:', 'check:2bad', 'check:a, prose', 'check:a,', ',check:a', 'check:a.b', 'check:a\n  More prose', 'check:a, check:a'])('rejects free-text or malformed Completion criteria: %s', (value) => {
    const parsed = parsePortablePlan(plan(`- **Completion criteria:** ${value}`));
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining('check:') });
  });

  it.each(['', 'None', 'check:tests', 'Cannot write.'])('always rejects Stop conditions: %s with actionable retry diagnostic', (value) => {
    const parsed = parsePortablePlan(plan(`- Stop conditions: ${value}`));
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining('On failure:') });
  });

  it('rejects near-miss free-text completion instead of ignoring it', () => {
    expect(parsePortablePlan(plan('- Completion criterion: prose'))).toMatchObject({ ok: false, reason: expect.stringContaining('check:<name>') });
  });

  it('rejects duplicate completion declarations instead of silently taking last', () => {
    expect(parsePortablePlan(plan('- Completion criteria: prose\n- Completion criteria: check:tests'))).toMatchObject({ ok: false, reason: expect.stringContaining('conflicting labels') });
  });

  it('keeps labels inside fenced Work examples inert', () => {
    const text = plan('  ```md\n  - Completion criteria: prose\n  - Stop conditions: example\n  ```\n- Completion criteria: check:tests');
    expect(parsePortablePlan(text)).toMatchObject({ ok: true, units: [{ checks: ['tests'], task: expect.stringContaining('Stop conditions: example') }] });
  });
});
