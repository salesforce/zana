import { describe, expect, it } from 'vitest';
import { formatSquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';
import { lintPlan, planParallelWidth, type LintUnit } from '../plan-lint.js';

const u = (id: string, dependencies: string[] = [], files?: string[], readOnly?: boolean): LintUnit => ({
  id, dependencies, ...(files ? { files } : {}), ...(readOnly === undefined ? {} : { readOnly })
});
const independent = (n: number): LintUnit[] => Array.from({ length: n }, (_, i) => u(`s${i + 1}`));
const chain = (n: number): LintUnit[] => Array.from({ length: n }, (_, i) => u(`s${i + 1}`, i ? [`s${i}`] : []));

/** Modelled on Geoff's run 4dfef173: 15 steps, s1 has six transitive dependents, the rest are independent. */
const GEOFF_15: LintUnit[] = [
  u('s1'), u('s2', ['s1']), u('s3', ['s1']), u('s4', ['s1']), u('s5', ['s2']), u('s6', ['s3']), u('s7', ['s5']),
  ...['s8', 's9', 's10', 's11', 's12', 's13', 's14', 's15'].map((id) => u(id))
];

describe('planParallelWidth (REQ-2, D5)', () => {
  it('is the number of steps for independent steps', () => {
    expect(planParallelWidth(independent(1))).toBe(1);
    expect(planParallelWidth(independent(3))).toBe(3);
  });
  it('is 1 for a serial chain', () => {
    expect(planParallelWidth(chain(5))).toBe(1);
    expect(planParallelWidth(chain(16))).toBe(1);
  });
  it('is 2 for two parallel steps feeding one join', () => {
    expect(planParallelWidth([u('a'), u('b'), u('c', ['a', 'b'])])).toBe(2);
  });
  it('is 2 for a diamond', () => {
    expect(planParallelWidth([u('a'), u('b', ['a']), u('c', ['a']), u('d', ['b', 'c'])])).toBe(2);
  });
  it('counts steps with no path between them even when they sit at different depths (exact, not levels)', () => {
    // a-b-c is a chain, x is free, d hangs off a: {x, b, d} (or {x, c, d}) are three steps with no path between them.
    expect(planParallelWidth([u('a'), u('b', ['a']), u('c', ['b']), u('x'), u('d', ['a'])])).toBe(3);
  });
  it('is exact for the 15-step plan with six dependents on one step', () => {
    // s2..s7 form chains s2-s5-s7, s3-s6 and s4, so at most 3 of them run together; the eight free steps add 8.
    expect(planParallelWidth(GEOFF_15)).toBe(8 + 3);
  });
  it('skips the check above 200 steps and still answers at exactly 200', () => {
    expect(planParallelWidth(independent(200))).toBe(200);
    expect(planParallelWidth(independent(201))).toBeUndefined();
  });
  it('skips the check for a cycle or an unknown dependency instead of throwing', () => {
    expect(planParallelWidth([u('a', ['b']), u('b', ['a'])])).toBeUndefined();
    expect(planParallelWidth([u('a', ['a'])])).toBeUndefined();
    expect(planParallelWidth([u('a', ['ghost']), u('b')])).toBeUndefined();
  });
});

describe('lintPlan width Check (REQ-1, D4, D5)', () => {
  const widthFindings = (units: LintUnit[], workerCount: number | undefined) =>
    lintPlan({ units, workerCount }).filter((finding) => !finding.stepId);

  it('warns when the widest set of parallel steps is smaller than the worker count', () => {
    const [finding, ...rest] = widthFindings(chain(4), 2);
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({ requirement: 'plan', severity: 'warning', candidateSlots: [], suggestion: '' });
    expect(finding.detail).toMatch(/^Only 1 step can run at the same time, but this Squad has 2 workers\. The others will wait\.$/);
  });
  it('warns for the near-serial 16-step plan checked against 2 worker slots', () => {
    const [finding] = widthFindings(chain(16), 2);
    expect(finding.detail).toContain('Only 1 ');
    expect(finding.detail).toContain('2 workers');
  });
  it('names the real width and the worker count for a wider plan', () => {
    const [finding] = widthFindings([u('a'), u('b'), u('c', ['a', 'b'])], 4);
    expect(finding.detail).toContain('Only 2 steps can run at the same time, but this Squad has 4 workers.');
  });
  it('is silent when the width equals or exceeds the worker count', () => {
    expect(widthFindings([u('a'), u('b'), u('c', ['a', 'b'])], 2)).toEqual([]);
    expect(widthFindings(independent(5), 2)).toEqual([]);
  });
  it('is silent with no Squad (no team means no width warning)', () => {
    expect(widthFindings(chain(10), undefined)).toEqual([]);
    expect(widthFindings(chain(10), 0)).toEqual([]);
  });
  it('is silent above 200 steps, for a cycle and for an unknown dependency, and does not throw', () => {
    expect(widthFindings(chain(201), 3)).toEqual([]);
    expect(widthFindings([u('a', ['b']), u('b', ['a'])], 3)).toEqual([]);
    expect(widthFindings([u('a', ['ghost']), u('b', ['a'])], 3)).toEqual([]);
  });
  it('is a Check in plain words: launch stays allowed, no internal terms', () => {
    const [finding] = widthFindings(chain(3), 2);
    const text = formatSquadPlanFinding(finding);
    expect(text).toContain('Launch is still allowed');
    expect(text).not.toMatch(/requirement|severity|stepId|blocking/i);
    expect(lintPlan({ units: chain(3), workerCount: 2 }).every((f) => f.severity === 'warning' && f.requirement === 'plan')).toBe(true);
  });
});

describe('lintPlan mixed contract-and-UI step (REQ-3, D6)', () => {
  const stepFindings = (units: LintUnit[]) => lintPlan({ units, workerCount: undefined });

  it('warns once, naming the step, for the synthetic E5 unit', () => {
    const findings = stepFindings([u('e5', [], ['apps/server/src/services/sync/store.ts', 'apps/app/src/views/ConflictReview.tsx'])]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ stepId: 'e5', requirement: 'plan', severity: 'warning' });
    expect(findings[0].detail).toBe('Step e5 changes both a server contract and the screen that uses it. Split it so the contract lands first.');
  });
  it('warns once even when several paths sit on each side', () => {
    const findings = stepFindings([u('x', [], ['packages/domain/a.ts', 'apps/server/b.ts', 'src/components/A.tsx', 'src/views/B.tsx'])]);
    expect(findings.filter((f) => f.stepId === 'x')).toHaveLength(1);
  });
  it('does not warn for a server-only or UI-only scope, or for no files', () => {
    expect(stepFindings([u('a', [], ['apps/server/a.ts', 'packages/domain/b.ts'])])).toEqual([]);
    expect(stepFindings([u('b', [], ['src/components/A.tsx', 'src/views/B.tsx', 'apps/app/c.tsx'])])).toEqual([]);
    expect(stepFindings([u('c', [], [])])).toEqual([]);
    expect(stepFindings([u('d')])).toEqual([]);
  });
  it('matches whole path segments, not substrings', () => {
    expect(stepFindings([u('a', [], ['src/serverless/x.ts', 'src/components/A.tsx'])])).toEqual([]);
    expect(stepFindings([u('b', [], ['src/server/x.ts', 'src/webhook/y.ts'])])).toEqual([]);
    expect(stepFindings([u('c', [], ['src/server/x.ts', 'src/web/y.ts'])]).map((f) => f.stepId)).toEqual(['c']);
  });
  it('matches case-insensitively and with the two-segment apps/app entry', () => {
    expect(stepFindings([u('a', [], ['SRC/Server/a.ts', 'src/Components/B.tsx'])]).map((f) => f.stepId)).toEqual(['a']);
    expect(stepFindings([u('b', [], ['apps/server/a.ts', 'apps/app/z.ts'])]).map((f) => f.stepId)).toEqual(['b']);
    expect(stepFindings([u('c', [], ['apps/server/a.ts', 'apps/application/z.ts'])])).toEqual([]);
  });
  it('is silent for a plan with no lint trigger', () => {
    expect(lintPlan({ units: [u('a', [], ['a.txt']), u('b', [], ['b.txt'])], workerCount: 2 })).toEqual([]);
  });
});

describe('lintPlan mechanical contradictions (REQ-4, D7)', () => {
  const lint = (units: LintUnit[]) => lintPlan({ units, workerCount: undefined });

  it('warns for a read-only step that lists a Write scope', () => {
    const findings = lint([u('audit', [], ['report.md'], true)]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ stepId: 'audit', requirement: 'plan', severity: 'warning' });
    expect(findings[0].detail).toMatch(/read-only/i);
    expect(findings[0].detail).toMatch(/Write scope/);
  });
  it('is silent for a read-only step with no Write scope or an empty one', () => {
    expect(lint([u('a', [], undefined, true), u('b', [], [], true)])).toEqual([]);
  });
  it('warns, naming both steps and the path, when two parallel steps share a Write-scope path', () => {
    const findings = lint([u('a', [], ['shared/out.ts']), u('b', [], ['x.ts', 'shared/out.ts'])]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ requirement: 'plan', severity: 'warning' });
    expect(findings[0].detail).toContain('a');
    expect(findings[0].detail).toContain('b');
    expect(findings[0].detail).toContain('shared/out.ts');
  });
  it('is silent when a dependency path orders the two steps, directly or through another step', () => {
    expect(lint([u('a', [], ['shared.ts']), u('b', ['a'], ['shared.ts'])])).toEqual([]);
    expect(lint([u('a', [], ['shared.ts']), u('m', ['a']), u('c', ['m'], ['shared.ts'])])).toEqual([]);
  });
  it('is silent when parallel steps write different paths', () => {
    expect(lint([u('a', [], ['a.ts']), u('b', [], ['b.ts'])])).toEqual([]);
  });
  it('does not crash on a cycle or unknown dependency', () => {
    expect(() => lint([u('a', ['b'], ['x']), u('b', ['a'], ['x'])])).not.toThrow();
    expect(() => lint([u('a', ['ghost'], ['x']), u('b', [], ['x'])])).not.toThrow();
  });
});

describe('correctness obligations (QA, CodeNod OBL-001, OBL-002)', () => {
  it('OBL-001: a very long reverse-ordered dependency chain does not throw out of lint (REQ-2)', () => {
    const n = 30000;
    const units = Array.from({ length: n }, (_, i) => u(`s${i}`, i < n - 1 ? [`s${i + 1}`] : [], [`f${i}.ts`]));
    expect(() => lintPlan({ units, workerCount: 2 })).not.toThrow();
  });
  it('OBL-002: a UI package path alone is not a mixed contract-and-UI step (REQ-3)', () => {
    const found = lintPlan({ units: [u('a', [], ['packages/ui/Button.tsx'])], workerCount: undefined });
    expect(found.filter((f) => f.stepId === 'a')).toEqual([]);
  });
  it('Q1: skips the overlap and width work above the step cap, so no lint path is unbounded', () => {
    const shared = Array.from({ length: 300 }, (_, i) => u(`s${i}`, [], ['same.ts']));
    expect(lintPlan({ units: shared, workerCount: 5 }).some((f) => /write/i.test(f.detail ?? ''))).toBe(false);
    expect(planParallelWidth(shared)).toBeUndefined();
  });
  it('Q1: computes the closure of a long chain below the cap without recursion', () => {
    const units = Array.from({ length: 200 }, (_, i) => u(`s${i}`, i ? [`s${i - 1}`] : [], [`f${i}.ts`]));
    expect(planParallelWidth(units)).toBe(1);
  });
  it('Q2: a UI path with a different contract file is mixed, a single UI-package file is not', () => {
    const mixed = lintPlan({ units: [u('a', [], ['packages/domain/x.ts', 'apps/app/src/components/Y.tsx'])], workerCount: undefined });
    expect(mixed.filter((f) => f.stepId === 'a')).toHaveLength(1);
    expect(lintPlan({ units: [u('a', [], ['apps/app/src/api/x.ts'])], workerCount: undefined })).toEqual([]);
    expect(lintPlan({ units: [u('a', [], ['packages/ui/Button.tsx', 'apps/server/src/y.ts'])], workerCount: undefined }).some((f) => f.stepId === 'a')).toBe(true);
  });
  it('Q3: the same file spelled "./x/y.ts", "x//y.ts" and "x\\y.ts" is one path for the overlap check', () => {
    const found = lintPlan({ units: [u('a', [], ['./x/y.ts']), u('b', [], ['x\\y.ts']), u('c', [], ['x//y.ts'])], workerCount: undefined });
    expect(found.filter((f) => /can run at the same time but both write x\/y\.ts/.test(f.detail ?? ''))).toHaveLength(3);
  });
  it('F4: a plan with a cycle yields no width and no overlap findings and does not throw', () => {
    expect(lintPlan({ units: [u('a', ['b'], ['x']), u('b', ['a'], ['x'])], workerCount: 2 })).toEqual([]);
  });
});
