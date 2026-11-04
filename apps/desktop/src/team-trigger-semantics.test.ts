import { describe, expect, it, vi } from 'vitest';
import { NO_PLAN_STEPS_REASON, invalidProvidedPlanHold, planNormalizationNote, resolveSquadPlan, resolveTriggeredSquadPlan } from './team-trigger-semantics.js';

const validPlan = [
  '### write: Write output <!-- executable-step -->',
  '',
  '- **Depends on:** None',
  '- **Mode:** Mutating',
  '- **Write scope:** `output.txt`',
  '- **Work:** Create output.',
  '- **Verification:** Read output.'
].join('\n');

describe('resolveTriggeredSquadPlan', () => {
  it('starts inferred objectives in freeform coordination', () => {
    expect(resolveTriggeredSquadPlan('infer', 'Inspect current state and ship fix.')).toEqual({
      coordinationMode: 'freeform'
    });
  });

  it('uses structured coordination only after a provided plan validates as a durable DAG', () => {
    expect(resolveTriggeredSquadPlan('provided', validPlan)).toMatchObject({
      coordinationMode: 'structured',
      workUnits: [{ id: 'write', files: ['output.txt'] }]
    });
  });

  it('keeps an invalid provided plan out of structured coordination and exposes its correction reason', () => {
    const invalidPlan = '### write: Write output <!-- executable-step -->\n\n- **Mode:** Mutating\n- **Work:** Create output.\n- **Verification:** Read output.';

    expect(resolveTriggeredSquadPlan('provided', invalidPlan)).toEqual({
      coordinationMode: 'freeform',
      planError: expect.any(String)
    });
  });

  it('detects invalid provided plans using parser marker whitespace and case grammar', () => {
    const invalidPlan = '  ### write: Write output <!--  EXECUTABLE-STEP  -->\n\n- **Mode:** Mutating\n- **Work:** Create output.\n- **Verification:** Read output.';

    expect(resolveTriggeredSquadPlan('provided', invalidPlan)).toEqual({
      coordinationMode: 'freeform',
      planError: expect.any(String)
    });
  });

  it('does not expose an invalid supplied plan as an executable initial task', () => {
    expect(invalidProvidedPlanHold('orchestrator')).toContain('Do not begin, assign, or perform work');
    expect(invalidProvidedPlanHold('orchestrator')).toContain('End your turn now');
    expect(invalidProvidedPlanHold('worker')).toContain('Wait for the coordinator');
  });

  it('parks provided prose with no plan steps for correction instead of falling through to freeform repair', () => {
    expect(resolveTriggeredSquadPlan('provided', 'Fix the flaky test and ship it.')).toEqual({
      coordinationMode: 'freeform',
      planError: 'no executable steps found'
    });
  });
});

describe('resolveSquadPlan', () => {
  const stepWithoutScope = '### write: Write output <!-- executable-step -->\n\n- **Mode:** Mutating\n- **Work:** Create output.\n- **Verification:** Read output.';

  it('never parses an inferred plan, whatever the text', () => {
    expect(resolveSquadPlan('infer', [validPlan, 'prose'])).toEqual({ coordinationMode: 'freeform' });
  });

  it('seeds from the first candidate that is a complete DAG, skipping invalid and blank ones', () => {
    expect(resolveSquadPlan('provided', [undefined, '   ', 'prose goal', stepWithoutScope, validPlan])).toMatchObject({
      coordinationMode: 'structured',
      workUnits: [{ id: 'write' }]
    });
  });

  it('reports the reason from a candidate that really has plan steps over a prose candidate', () => {
    const result = resolveSquadPlan('provided', ['prose goal', stepWithoutScope, 'more prose']);
    expect(result.coordinationMode).toBe('freeform');
    expect(result.workUnits).toBeUndefined();
    expect(result.planError).toBeTruthy();
    expect(result.planError).not.toBe('no executable steps found');
  });

  it('falls back to the first parse failure when no candidate has plan steps', () => {
    expect(resolveSquadPlan('provided', ['prose goal']).planError).toBe('no executable steps found');
  });

  it('reports no plan steps when there is no usable candidate text at all', () => {
    expect(resolveSquadPlan('provided', [])).toEqual({ coordinationMode: 'freeform', planError: NO_PLAN_STEPS_REASON });
    expect(resolveSquadPlan('provided', [undefined, ''])).toEqual({ coordinationMode: 'freeform', planError: NO_PLAN_STEPS_REASON });
  });

  it('surfaces a non-Error normalization failure as a string reason', async () => {
    const preflight = await import('@zana-ai/zcc-server/services/launch/preflight');
    const spy = vi.spyOn(preflight, 'normalizeExecutionPlan').mockImplementation(() => { throw 'boom'; });
    try {
      expect(resolveSquadPlan('provided', [validPlan]).planError).toBe('boom');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('plan normalization pass-through', () => {
  const recoverable = validPlan.replace('### write:', '### Write:');

  it('accepts a recoverable-only provided plan as structured and exposes the repair notes', () => {
    const resolved = resolveSquadPlan('provided', [recoverable]);
    expect(resolved.coordinationMode).toBe('structured');
    expect(resolved.workUnits?.[0].id).toBe('write');
    expect(resolved.normalizations).toEqual(['step "Write" id normalized to "write"']);
    expect(resolved.idRenames).toEqual([{ from: 'Write', to: 'write' }]);
    expect(resolved).not.toHaveProperty('planError');
  });

  it('carries notes through the triggered-squad resolver', () => {
    expect(resolveTriggeredSquadPlan('provided', recoverable).normalizations).toHaveLength(1);
  });

  it('omits the normalizations key for a clean plan', () => {
    expect(resolveSquadPlan('provided', [validPlan])).not.toHaveProperty('normalizations');
    expect(resolveSquadPlan('provided', [validPlan])).not.toHaveProperty('idRenames');
  });

  it('still reports a substantive failure for a plan that is missing Work', () => {
    const resolved = resolveSquadPlan('provided', ['### write: Write <!-- executable-step -->\n\n- **Mode:** Mutating']);
    expect(resolved.coordinationMode).toBe('freeform');
    expect(resolved.planError).toContain('missing Work');
    expect(resolved).not.toHaveProperty('normalizations');
  });
});

describe('planNormalizationNote', () => {
  it('is empty for undefined or empty notes', () => {
    expect(planNormalizationNote(undefined)).toBe('');
    expect(planNormalizationNote([])).toBe('');
  });

  it('lists each id rename as a bullet under a header line', () => {
    const note = planNormalizationNote([{ from: 'U1', to: 'u1' }, { from: 'Home Step', to: 'home-step' }]);
    expect(note.split('\n')).toEqual([
      'The supplied plan was accepted after automatic normalization; use the normalized ids:',
      '- step "U1" id normalized to "u1"',
      '- step "Home Step" id normalized to "home-step"'
    ]);
  });

  it('omits label-fold and dependency repairs from the agent-facing note', () => {
    const plan = validPlan.replace('### write:', '### Write:').replace('**Depends on:**', '**Depend on:**');
    const resolved = resolveSquadPlan('provided', [plan]);
    expect(resolved.normalizations).toEqual([
      'step "Write" id normalized to "write"',
      'step write label "depend on" treated as "depends on"'
    ]);
    const note = planNormalizationNote(resolved.idRenames);
    expect(note).toContain('step "Write" id normalized to "write"');
    expect(note).not.toContain('depend on');
  });

  it('caps the list at 20 renames and summarizes the rest', () => {
    const renames = Array.from({ length: 25 }, (_, index) => ({ from: `U${index}`, to: `u${index}` }));
    const lines = planNormalizationNote(renames).split('\n');
    expect(lines).toHaveLength(22);
    expect(lines[20]).toBe('- step "U19" id normalized to "u19"');
    expect(lines[21]).toBe('- …and 5 more');
    expect(planNormalizationNote(renames.slice(0, 20))).not.toContain('more');
  });

  it('truncates each id to 80 characters and the whole note to 2000', () => {
    const long = 'X'.repeat(500);
    const single = planNormalizationNote([{ from: long, to: 'x'.repeat(500) }]);
    expect(single).toContain(`"${'X'.repeat(80)}…"`);
    expect(single).toContain(`"${'x'.repeat(80)}…"`);
    expect(single).not.toContain('X'.repeat(81));
    const many = planNormalizationNote(Array.from({ length: 30 }, () => ({ from: long, to: 'x'.repeat(500) })));
    expect(many.length).toBe(2_000);
    expect(many.startsWith('The supplied plan was accepted after automatic normalization')).toBe(true);
  });
});

/**
 * squad-bugs: parser/renderer precedence. What the host seeds must be the same
 * plan the operator-facing surfaces describe: the earliest candidate that is a
 * complete DAG wins, a later (even valid) candidate never overrides it, and
 * example markers inside a fenced block are not executable steps.
 */
describe('resolveSquadPlan precedence (squad-bugs)', () => {
  const planWith = (id: string) => validPlan.replace('### write:', `### ${id}:`);

  it('seeds from the earliest valid source and ignores a later valid goal plan', () => {
    const resolved = resolveSquadPlan('provided', [planWith('from-source'), planWith('from-goal')]);
    expect(resolved.workUnits?.map((unit) => unit.id)).toEqual(['from-source']);
  });

  it('an invalid source does not mask a valid goal plan, and reports no planError', () => {
    const invalid = '### broken: Broken <!-- executable-step -->\n\n- **Mode:** Mutating\n- **Work:** x.\n- **Verification:** y.';
    const resolved = resolveSquadPlan('provided', [invalid, planWith('from-goal')]);
    expect(resolved.coordinationMode).toBe('structured');
    expect(resolved.workUnits?.map((unit) => unit.id)).toEqual(['from-goal']);
    expect(resolved).not.toHaveProperty('planError');
  });
});
