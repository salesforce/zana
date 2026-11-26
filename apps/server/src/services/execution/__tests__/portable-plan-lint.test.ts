import { describe, expect, it } from 'vitest';
import {
  diagnoseNoSteps, lintMixedContractAndUi, MAX_WIDTH_UNITS, NO_EXECUTABLE_STEPS_REASON, parsePortablePlan, planCriticalPathWidth
} from '../portable-plan.js';

const step = (id: string, body: string) => `### ${id}: Title ${id} <!-- executable-step -->\n${body}\n`;

/** A 16-step near-serial chain: every step depends on the previous one (width 1). */
const SERIAL_CHAIN_PLAN = Array.from({ length: 16 }, (_, i) =>
  step(`s${i + 1}`, `${i ? `- **Depends on:** s${i}\n` : ''}- **Write scope:** \`apps/server/src/s${i + 1}.ts\`\n- **Work:** do ${i + 1}\n- **Verification:** v`)).join('\n');

/** The E5 shape: one unit whose write scope spans a server contract and the UI. */
const MIXED_UNIT_PLAN = [
  step('a', '- **Write scope:** `apps/server/src/http/routes.ts, apps/app/src/panel.tsx`\n- **Work:** wire both\n- **Verification:** v'),
  step('b', '- **Write scope:** `apps/server/src/other.ts`\n- **Work:** server only\n- **Verification:** v')
].join('\n');

describe('planCriticalPathWidth', () => {
  it('is 1 for a serial chain', () => {
    const units = Array.from({ length: 16 }, (_, i) => ({ id: `s${i}`, dependencies: i ? [`s${i - 1}`] : [] }));
    expect(planCriticalPathWidth(units)).toBe(1);
  });
  it('counts independent steps and diamonds', () => {
    expect(planCriticalPathWidth([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(3);
    expect(planCriticalPathWidth([{ id: 'a' }, { id: 'b', dependencies: ['a'] }, { id: 'c', dependencies: ['a'] }, { id: 'd', dependencies: ['b', 'c'] }])).toBe(2);
  });
  it('uses transitive ordering, not only direct edges', () => {
    // a -> b -> c, plus d with no edges: {a,d} or {c,d} is the widest set.
    expect(planCriticalPathWidth([{ id: 'a' }, { id: 'b', dependencies: ['a'] }, { id: 'c', dependencies: ['b'] }, { id: 'd' }])).toBe(2);
  });
  it('ignores unknown dependencies and gives up on empty, cyclic, duplicate-id or oversized plans', () => {
    expect(planCriticalPathWidth([{ id: 'a', dependencies: ['zzz'] }])).toBe(1);
    expect(planCriticalPathWidth([])).toBeUndefined();
    expect(planCriticalPathWidth([{ id: 'a', dependencies: ['b'] }, { id: 'b', dependencies: ['a'] }])).toBeUndefined();
    expect(planCriticalPathWidth([{ id: 'a' }, { id: 'a' }])).toBeUndefined();
    expect(planCriticalPathWidth(Array.from({ length: MAX_WIDTH_UNITS + 1 }, (_, i) => ({ id: `u${i}` })))).toBeUndefined();
  });
});

describe('lintMixedContractAndUi', () => {
  it('warns once for a unit whose scope spans apps/server and apps/app', () => {
    const findings = lintMixedContractAndUi([{ id: 'a', files: ['apps/server/src/x.ts', './apps/app/src/y.tsx'] }, { id: 'b', files: ['apps/server/src/x.ts'] }]);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'warning', requirement: 'plan', stepId: 'a' });
    expect(findings[0]!.message).toContain('apps/server/src/x.ts');
  });
  it('treats shared contract packages and plugin app folders as server and UI paths, and tolerates backslashes', () => {
    expect(lintMixedContractAndUi([{ id: 'a', files: ['packages\\domain\\src\\x.ts', 'plugins/design-docs/src/app/p.tsx'] }])).toHaveLength(1);
  });
  it('is quiet for UI-only, server-only and unscoped units', () => {
    expect(lintMixedContractAndUi([{ id: 'a', files: ['apps/app/src/a.tsx'] }, { id: 'b', files: ['apps/server/src/b.ts'] }, { id: 'c' }])).toEqual([]);
  });
});

describe('parsePortablePlan lint findings', () => {
  it('carries the mixed-unit warning as a PortablePlanFinding and keeps both units', () => {
    const parsed = parsePortablePlan(MIXED_UNIT_PLAN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.units).toHaveLength(2);
    expect(parsed.findings?.filter((f) => f.severity === 'warning' && f.requirement === 'plan').map((f) => f.stepId)).toEqual(['a']);
  });
  it('parses the 16-step chain with no lint warning at parse time (width needs the roster)', () => {
    const parsed = parsePortablePlan(SERIAL_CHAIN_PLAN);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.units).toHaveLength(16);
    expect(planCriticalPathWidth(parsed.units)).toBe(1);
    expect(parsed.findings ?? []).toEqual([]);
  });
});

describe('diagnoseNoSteps', () => {
  it('keeps the stable parse error and explains it separately', () => {
    expect(parsePortablePlan('just prose')).toMatchObject({ ok: false, reason: NO_EXECUTABLE_STEPS_REASON });
  });
  it.each([
    ['', /empty/],
    ['   \n', /empty/],
    ['Build the thing, then test it.', /reads as prose/],
    ['## Notes\n### Idea\ntext', /no "## Execution Plan" section and no <!-- executable-step --> marker/],
    ['## Execution Plan\nSome words.', /no "###" step headings/],
    ['## Execution Plan\n### Overview\ntext\n### Another\nmore', /none looked like "<id>: <title>"/],
    ['### a: T <!-- executable-step -->\n', /1 marked step heading found, but none had a usable body/],
    ['```squad-plan\n## Execution Plan\n', /not closed/]
  ])('explains %j', (text, expected) => {
    expect(diagnoseNoSteps(text)).toMatch(expected);
  });
  it('ignores headings inside code fences', () => {
    expect(diagnoseNoSteps('```\n## Execution Plan\n### a: T\n```\n')).toMatch(/reads as prose/);
  });
  it('does not throw on non-string input', () => {
    expect(diagnoseNoSteps(undefined as unknown as string)).toMatch(/empty/);
  });
});
