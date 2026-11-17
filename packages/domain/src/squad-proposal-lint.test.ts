import { describe, expect, it } from 'vitest';
import { capSquadPlanFindings, formatSquadPlanFinding, formatSquadPlanFindingProblem, formatSquadPlanSkipImpact, SQUAD_PLAN_FINDING_CAP, type SquadPlanFinding } from './squad-proposal.js';

const lintWarning = (stepId: string | undefined, detail: string): SquadPlanFinding => ({
  ...(stepId ? { stepId } : {}), requirement: 'plan', severity: 'warning', candidateSlots: [], suggestion: '', detail
});

describe('formatSquadPlanSkipImpact (REQ-9)', () => {
  it('lists up to five steps in the order given', () => {
    expect(formatSquadPlanSkipImpact(['b', 'c', 'd'])).toBe('If this step fails, these steps will not run: b, c, d');
    expect(formatSquadPlanSkipImpact(['a', 'b', 'c', 'd', 'e'])).toBe('If this step fails, these steps will not run: a, b, c, d, e');
  });
  it('shows the first five and "and N more" after that', () => {
    expect(formatSquadPlanSkipImpact(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('If this step fails, these steps will not run: a, b, c, d, e and 2 more');
    expect(formatSquadPlanSkipImpact(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('If this step fails, these steps will not run: a, b, c, d, e and 1 more');
  });
  it('honours a custom number of shown steps', () => {
    expect(formatSquadPlanSkipImpact(['a', 'b', 'c', 'd'], 2)).toBe('If this step fails, these steps will not run: a, b and 2 more');
  });
});

describe('plan Check wording (REQ-7, D1)', () => {
  const warning = lintWarning('e5', 'Step e5 changes both a server contract and the screen that uses it. Split it so the contract lands first.');
  it('says launch is still allowed and does not tell the user to ask the agent to revise', () => {
    const text = formatSquadPlanFinding(warning);
    expect(text).toContain('Launch is still allowed');
    expect(text).toContain('Split it so the contract lands first');
    expect(text).not.toContain('Ask the agent to revise the plan');
  });
  it('names no internal term', () => {
    expect(formatSquadPlanFinding(lintWarning(undefined, 'Only 1 step can run at the same time, but this Squad has 2 workers. The others will wait.')))
      .not.toMatch(/requirement|severity|candidateSlots|stepId|warning|blocking/i);
  });
  it('keeps the blocking plan wording unchanged (existing users)', () => {
    const blocking: SquadPlanFinding = { requirement: 'plan', severity: 'blocking', candidateSlots: [], suggestion: '', detail: 'no executable steps found' };
    expect(formatSquadPlanFinding(blocking)).toBe('The plan: no executable steps found. Ask the agent to revise the plan, or edit it and launch again.');
  });
});

describe('finding cap (REQ-7)', () => {
  it('shows 50 findings and reports the rest as hidden, blocking first', () => {
    const many = Array.from({ length: 60 }, (_, i) => lintWarning(`s${i}`, `Step s${i} changes both a server contract and the screen that uses it.`));
    const blocking: SquadPlanFinding = { requirement: 'required-role', severity: 'blocking', stepId: 'z', candidateSlots: [], suggestion: '' };
    const capped = capSquadPlanFindings([...many, blocking]);
    expect(SQUAD_PLAN_FINDING_CAP).toBe(50);
    expect(capped.findings).toHaveLength(50);
    expect(capped.hidden).toBe(11);
    expect(capped.findings[0].severity).toBe('blocking');
  });
});

describe('formatSquadPlanFindingProblem for a lint Check (REQ-7, D1)', () => {
  it('says launch is still allowed for a plan warning, and not for a blocking plan finding', () => {
    const warn = formatSquadPlanFindingProblem(lintWarning('a', 'it changes two things.'));
    expect(warn).toContain('Launch is still allowed');
    const block = formatSquadPlanFindingProblem({ ...lintWarning('a', 'it is broken.'), severity: 'blocking' });
    expect(block).not.toContain('Launch is still allowed');
  });
  it('A3: says what a failure policy changes', () => {
    expect(formatSquadPlanSkipImpact(['b'], 5, 'retry')).toBe('If this step still fails after its retries, these steps will not run: b');
    expect(formatSquadPlanSkipImpact(['b', 'c'], 1, 'fail-run')).toBe('If this step fails, the whole run stops and these steps will not run: b and 1 more');
  });
});
