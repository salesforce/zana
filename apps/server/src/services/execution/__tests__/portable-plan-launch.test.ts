import { describe, expect, it } from 'vitest';
import { parseLaunchSection, parsePortablePlan } from '../portable-plan.js';

const step = (fields = '', id = 'review') => `### ${id}: Review <!-- executable-step -->
- Work: Review changes.
- Verification: Run tests.
${fields}`;
const launch = (fields: string) => `## Launch\n${fields}\n## Execution Plan\n${step()}`;

describe('portable plan Launch declarations', () => {
  it('returns empty declarations when Launch is absent or empty', () => {
    expect(parseLaunchSection(step())).toEqual({ ok: true, launch: {} });
    expect(parseLaunchSection('## Launch\n\n## Execution Plan')).toEqual({ ok: true, launch: {} });
  });

  it('round-trips every launch field without overloading Requires', () => {
    const text = `## Launch
- **worktree:** true
- **onComplete:** merge
- **push:** true
- **failurePolicyDefault:** fail-run
- **checks:** check:lint, check:_test-2
## Execution Plan
${step('- Requires: Skills: alpha; MCP servers: repo')}`;
    const parsed = parsePortablePlan(text);
    expect(parsed).toMatchObject({
      ok: true,
      launch: { worktree: true, onComplete: 'merge', push: true, failurePolicyDefault: 'fail-run', checks: ['lint', '_test-2'] },
      units: [{ requires: { skills: ['alpha'], mcpServers: ['repo'] } }]
    });
    expect(parsePortablePlan(text)).toEqual(parsed);
  });

  it.each(['leave', 'merge', 'delete'])('reads onComplete %s', (onComplete) => {
    expect(parsePortablePlan(launch(`- onComplete: ${onComplete}`))).toMatchObject({ ok: true, launch: { onComplete } });
  });

  it('preserves explicit false and reads push capability and singular check label', () => {
    expect(parsePortablePlan(launch('- worktree: false\n- push: false'))).toMatchObject({ ok: true, launch: { worktree: false, push: false } });
    expect(parsePortablePlan(launch('- Capabilities: push\n- check: check:tests'))).toMatchObject({ ok: true, launch: { push: true, checks: ['tests'] } });
  });

  it.each([
    ['worktree', 'yes'], ['push', '1'], ['onComplete', 'discard'], ['failurePolicyDefault', 'retry'],
    ['checks', 'npm test'], ['checks', 'check:a,'], ['checks', 'check:2bad'], ['checks', 'check:a, check:a'],
    ['Capabilities', 'push, fetch'], ['Capabilities', 'push, push'], ['unknown', 'true']
  ])('rejects invalid Launch %s: %s without defaults', (field, value) => {
    const parsed = parsePortablePlan(launch(`- ${field}: ${value}`));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason.toLowerCase()).toContain(field.toLowerCase());
  });

  it.each([
    '- push: true\n- push: false', '- push: false\n- Capabilities: push',
    '- checks: check:a\n- check: check:b'
  ])('rejects duplicate declarations: %s', (fields) => {
    expect(parsePortablePlan(launch(fields))).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate') });
  });

  it('rejects duplicate Launch sections and malformed field lines', () => {
    expect(parsePortablePlan(`## Launch\n- push: true\n${launch('- push: false')}`)).toMatchObject({ ok: false, reason: expect.stringContaining('duplicate Launch') });
    expect(parsePortablePlan(launch('- push true'))).toMatchObject({ ok: false, reason: expect.stringContaining('Launch') });
  });

  it('does not read fenced Launch examples or ordinary sections as declarations', () => {
    expect(parsePortablePlan(`\`\`\`md\n## Launch\n- push: true\n\`\`\`\n## Notes\n- push: true\n${step()}`)).toEqual(parsePortablePlan(step()));
  });

  it('rejects fenced Launch declarations rather than silently dropping values', () => {
    expect(parsePortablePlan(launch('```text\n- push: true\n```'))).toMatchObject({ ok: false, reason: expect.stringContaining('Launch') });
    expect(parseLaunchSection('## Launch\n```text\n- push: true')).toMatchObject({ ok: false, reason: expect.stringContaining('Launch') });
  });
});

describe('portable plan On failure edges', () => {
  it('round-trips named retry targets and integer limits without ceilinging', () => {
    const text = `${step('- On failure: retry repair up to 3 with feedback\n- maxIterations: 150\n- noProgressLimit: 2')}\n${step('', 'repair')}`;
    expect(parsePortablePlan(text)).toMatchObject({ ok: true, units: [{ onFailure: { kind: 'retry', stepId: 'repair', maxRetries: 3, maxIterations: 150, noProgressLimit: 2 } }, { id: 'repair' }] });
    expect(parsePortablePlan(text)).toEqual(parsePortablePlan(text));
  });

  it('reads explicit fail run without inventing default edges', () => {
    expect(parsePortablePlan(step('- On failure: fail run'))).toMatchObject({ ok: true, units: [{ onFailure: { kind: 'fail-run' } }] });
    const parsed = parsePortablePlan(step());
    expect(parsed.ok && parsed.units[0]).not.toHaveProperty('onFailure');
  });

  it('normalizes retry references like heading ids', () => {
    expect(parsePortablePlan(`${step('- On failure: retry Repair Step up to 1 with feedback')}\n${step('', 'Repair Step')}`)).toMatchObject({ ok: true, units: [{ onFailure: { stepId: 'repair-step' } }, { id: 'repair-step' }] });
  });

  it('allows a bounded self retry', () => {
    expect(parsePortablePlan(step('- On failure: retry review up to 1 with feedback'))).toMatchObject({ ok: true, units: [{ onFailure: { stepId: 'review' } }] });
  });

  it.each(['retry absent up to 2 with feedback', 'retry --- up to 2 with feedback', 'retry review up to 0 with feedback', 'retry review up to 1.5 with feedback', 'retry review up to 9007199254740992 with feedback', 'retry review up to 2', 'ignore', ''])('rejects invalid failure edge %s', (value) => {
    const parsed = parsePortablePlan(step(`- On failure: ${value}`));
    expect(parsed).toMatchObject({ ok: false, reason: expect.stringContaining('On failure') });
  });

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992', ''])('rejects invalid integer limits %s', (value) => {
    for (const label of ['maxIterations', 'noProgressLimit']) {
      expect(parsePortablePlan(step(`- On failure: retry review up to 2 with feedback\n- ${label}: ${value}`))).toMatchObject({ ok: false, reason: expect.stringContaining(label) });
    }
  });

  it('rejects orphan limits and duplicate failure fields', () => {
    expect(parsePortablePlan(step('- maxIterations: 2'))).toMatchObject({ ok: false, reason: expect.stringContaining('On failure') });
    expect(parsePortablePlan(step('- On failure: fail run\n- noProgressLimit: 2'))).toMatchObject({ ok: false, reason: expect.stringContaining('On failure') });
    expect(parsePortablePlan(step('- On failure: fail run\n- On failure: retry review up to 2 with feedback'))).toMatchObject({ ok: false, reason: expect.stringContaining('conflicting labels') });
    expect(parsePortablePlan(step('- On failure: retry review up to 2 with feedback\n- maxIterations: 2\n- maxIterations: 3'))).toMatchObject({ ok: false, reason: expect.stringContaining('conflicting labels') });
  });
});
