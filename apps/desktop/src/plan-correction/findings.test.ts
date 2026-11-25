import { describe, expect, it, vi } from 'vitest';
import { findingOffersFix, judgeInferredPlan, parserFindingsToSquadFindings, planCorrectionReason, planIntakeDisposition } from './findings.js';

describe('plan correction findings', () => {
  it('maps parser findings into the shared shape with no candidates', () => {
    expect(parserFindingsToSquadFindings(undefined)).toEqual([]);
    expect(parserFindingsToSquadFindings([{ severity: 'blocking', requirement: 'plan', stepId: 'a', message: 'no scope' }]))
      .toEqual([{ stepId: 'a', requirement: 'plan', severity: 'blocking', candidateSlots: [], suggestion: '', detail: 'no scope' }]);
  });

  it('adds one human sentence per blocking finding only', () => {
    const reason = planCorrectionReason('step a is incomplete.', [
      { severity: 'blocking', requirement: 'plan', stepId: 'a', message: 'Write scope is missing' },
      { severity: 'repair', requirement: 'format', message: 'heading fixed' },
      { severity: 'warning', requirement: 'format', message: 'two blocks' }
    ]);
    expect(reason).toContain('step a is incomplete. Step a: Write scope is missing');
    expect(reason).not.toContain('heading fixed');
    expect(reason).not.toContain('two blocks');
  });

  it('does not repeat a finding the error already states, and leaves the error alone without findings', () => {
    expect(planCorrectionReason('Write scope is missing', [{ severity: 'blocking', requirement: 'plan', message: 'Write scope is missing' }])).toBe('Write scope is missing');
    expect(planCorrectionReason('bad')).toBe('bad');
  });

  it('infers only for attended, inferable, step-less prose', () => {
    const base = { planError: 'no portable plan steps found', attended: true, canInfer: true, hasSteps: false };
    expect(planIntakeDisposition(base)).toBe('infer');
    expect(planIntakeDisposition({ ...base, attended: false })).toBe('card');
    expect(planIntakeDisposition({ ...base, canInfer: false })).toBe('card');
    expect(planIntakeDisposition({ ...base, hasSteps: true, planError: 'step x invalid' })).toBe('card');
    expect(planIntakeDisposition({ ...base, planError: undefined })).toBe('proceed');
  });

  it('offers a fix only for the exact single-match suggestion', () => {
    expect(findingOffersFix({ requirement: 'required-role', suggestion: 'Use "Reviewer" as the required role.' })).toBe(true);
    expect(findingOffersFix({ requirement: 'required-role', suggestion: 'Change the required role to one this Squad offers: A, B.' })).toBe(false);
    expect(findingOffersFix({ requirement: 'tier', suggestion: 'Use "Reviewer" as the required role.' })).toBe(false);
  });
});

describe('judgeInferredPlan', () => {
  const finding = { stepId: 'a', requirement: 'required-role' as const, severity: 'blocking' as const, candidateSlots: [], suggestion: 'Use "Builder" as the required role.' };
  const summary = { slots: [] } as never;
  const ctx = { projectId: 'p', executionId: 'e' };
  const mk = (record: { teamId: string; coordinationMode?: string } | undefined, findings = [finding]) => ({
    execution: vi.fn(async () => record), judge: vi.fn(async () => ({ findings, summary }))
  });

  it('returns the correction message and a human reason for blocking findings on an inferred plan', async () => {
    const deps = mk({ teamId: 't', coordinationMode: 'freeform' });
    const out = await judgeInferredPlan(deps, ctx, []);
    expect(out?.message).toContain('Step `a`');
    expect(out?.reason).toContain('Step a asks for a role');
  });
  it('skips provided plans, missing records and clean plans', async () => {
    expect(await judgeInferredPlan(mk({ teamId: 't', coordinationMode: 'structured' }), ctx, [])).toBeUndefined();
    expect(await judgeInferredPlan(mk(undefined), ctx, [])).toBeUndefined();
    expect(await judgeInferredPlan(mk({ teamId: 't', coordinationMode: 'freeform' }, [{ ...finding, severity: 'warning' as never }]), ctx, [])).toBeUndefined();
    const none = { execution: async () => ({ teamId: 't', coordinationMode: 'freeform' }), judge: async () => undefined };
    expect(await judgeInferredPlan(none, ctx, [])).toBeUndefined();
  });
});
