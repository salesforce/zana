import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';

const failure = (text: string) => {
  const result = parsePortablePlan(text);
  if (result.ok) throw new Error('expected the plan not to parse');
  return result;
};
const messages = (text: string) => failure(text).findings.map((finding) => finding.message).join('\n');

describe('no-steps explanation (REQ-5)', () => {
  it('explains an empty plan and says what to add, keeping the reason and the blocking finding', () => {
    const result = failure('   \n');
    expect(result.reason).toBe('empty plan text');
    expect(result.findings.some((f) => f.severity === 'blocking' && f.requirement === 'plan')).toBe(true);
    expect(messages('   \n')).toMatch(/empty/i);
    expect(messages('   \n')).toMatch(/\b(add|paste|write)\b/i);
  });
  it('says headings were found but none has a Work field, and what to change', () => {
    const text = '# Plan\n\n### alpha: First thing\n- **Depends on:** None\n\n### beta: Second thing\n- **Depends on:** alpha\n';
    const result = failure(text);
    expect(result.reason).toBe('no executable steps found');
    expect(result.findings.some((f) => f.severity === 'blocking' && f.requirement === 'plan')).toBe(true);
    const text2 = messages(text);
    expect(text2).toMatch(/heading/i);
    expect(text2).toMatch(/Work/);
    expect(text2).toMatch(/\b(add|give)\b/i);
  });
  it('says there are no step headings at all, and what a step looks like', () => {
    const text = 'Please build a small site with two pages and a nav label.\n\nMore prose, no headings.\n';
    const result = failure(text);
    expect(result.reason).toBe('no executable steps found');
    expect(result.findings.some((f) => f.severity === 'blocking' && f.requirement === 'plan')).toBe(true);
    expect(messages(text)).toMatch(/no step headings|no headings/i);
    expect(messages(text)).toMatch(/###/);
  });
  it('never uses an internal term in the explanation', () => {
    for (const text of ['', '### a: x\n- **Depends on:** None\n', 'prose only']) {
      expect(messages(text)).not.toMatch(/requirement|severity|parserVersion|stepId/i);
    }
  });
  it('leaves a plan that parses untouched (existing users)', () => {
    const ok = parsePortablePlan('### a: One <!-- executable-step -->\n- **Work:** do it\n- **Depends on:** None\n- **Write scope:** `a.txt`\n- **Verification:** exists\n');
    expect(ok.ok).toBe(true);
  });
});

describe('design-doc shaped plan as text (REQ-6, D2)', () => {
  const stepText = (i: number) => [
    `### step-${i}: Step number ${i} <!-- executable-step -->`,
    `- **Work:** ${'Explain the behaviour of this part of the sync in detail. '.repeat(14)}`,
    `- **Depends on:** ${i ? `step-${i - 1}` : 'None'}`,
    `- **Write scope:** \`src/part-${i}.ts\``,
    '- **Verification:** the part exists',
    ''
  ].join('\n');
  const plan = `# Design-doc plan\n\n${Array.from({ length: 45 }, (_, i) => stepText(i)).join('\n')}`;

  it('is about 45 KB and parses with every step, no file involved', () => {
    expect(plan.length).toBeGreaterThan(40_000);
    expect(plan.length).toBeLessThan(60_000);
    const result = parsePortablePlan(plan);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.units).toHaveLength(45);
  });
});
