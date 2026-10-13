import { describe, expect, it, vi } from 'vitest';
import { NO_PLAN_STEPS_REASON, invalidProvidedPlanHold, resolveSquadPlan, resolveTriggeredSquadPlan } from './team-trigger-semantics.js';

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
