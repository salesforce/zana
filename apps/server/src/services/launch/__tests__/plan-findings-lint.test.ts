import { describe, expect, it } from 'vitest';
import { capSquadPlanFindings, formatSquadPlanFinding } from '@zana-ai/zcc-domain/squad-proposal';
import { buildPlanFindings, hardFindingCounts, planBindings } from '../plan-findings.js';
import type { SlotRouteSnapshotV1 } from '../../execution/routing-policy.js';

const slots: SlotRouteSnapshotV1[] = [
  { slotId: 'orchestrator:builtin:orchestrator', personaId: 'builtin:orchestrator' },
  { slotId: 'w1', personaId: 'builtin:software-engineer', label: 'Engineer', roles: ['implementer'], level: 'high' },
  { slotId: 'w2', personaId: 'builtin:reviewer', label: 'Reviewer', roles: ['checker'], level: 'low' }
];
const step = (id: string, dependencies: string[] = [], extra: Record<string, unknown> = {}) => ({ id, dependencies, routing: { version: 1 as const }, ...extra });
const MIXED = ['apps/server/src/services/sync/store.ts', 'apps/app/src/views/ConflictReview.tsx'];

describe('buildPlanFindings with lint (REQ-1, REQ-3, REQ-4, D3, D4)', () => {
  it('reports a width Check for a serial plan on a two-worker Squad (workers exclude the orchestrator)', () => {
    const findings = buildPlanFindings({ units: [step('a'), step('b', ['a']), step('c', ['b'])], slotRoutes: slots });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ requirement: 'plan', severity: 'warning' });
    expect(findings[0].detail).toContain('this Squad has 2 workers');
  });
  it('reports nothing for width when no Squad judges the plan (no slots)', () => {
    expect(buildPlanFindings({ units: [step('a'), step('b', ['a'])], slotRoutes: [] })).toEqual([]);
  });
  it('reports a mixed-step Check even with no Squad, naming the step', () => {
    const findings = buildPlanFindings({ units: [step('e5', [], { files: MIXED })], slotRoutes: [] });
    expect(findings).toEqual([expect.objectContaining({ stepId: 'e5', requirement: 'plan', severity: 'warning' })]);
  });
  it('reports a contradiction Check from the units\' own fields', () => {
    const findings = buildPlanFindings({ units: [step('audit', [], { readOnly: true, files: ['x.md'] }), step('other')], slotRoutes: slots });
    expect(findings.some((f) => f.stepId === 'audit' && f.requirement === 'plan' && f.severity === 'warning')).toBe(true);
  });
  it('never blocks: lint adds no blocking finding and leaves the hard counts alone', () => {
    const units = [step('e5', [], { files: MIXED }), step('b', ['e5'], { routing: { version: 1 as const, requiredRole: 'auditor' } })];
    const findings = buildPlanFindings({ units, slotRoutes: slots });
    expect(hardFindingCounts(findings)).toEqual({ 'required-role': 1 });
    expect(findings.filter((f) => f.severity === 'blocking').map((f) => f.requirement)).toEqual(['required-role']);
  });
  it('keeps the parser finding when lint skips (cycle, unknown dependency)', () => {
    const findings = buildPlanFindings({
      units: [step('a', ['b']), step('b', ['a'])], slotRoutes: slots,
      parserFindings: [{ severity: 'blocking', requirement: 'plan', message: 'dependency cycle: a, b' }]
    });
    expect(findings).toEqual([expect.objectContaining({ severity: 'blocking', detail: 'dependency cycle: a, b' })]);
  });
});

describe('Check wording and cap (REQ-7)', () => {
  it('shows every lint finding as a Check sentence with "Launch is still allowed" and no internal terms', () => {
    const findings = buildPlanFindings({ units: [step('e5', [], { files: MIXED }), step('a'), step('b', ['a'])], slotRoutes: slots });
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      const text = formatSquadPlanFinding(finding);
      expect(text).toContain('Launch is still allowed');
      expect(text).not.toMatch(/requirement|severity|stepId|candidateSlots|blocking/i);
    }
  });
  it('respects the 50-finding cap with the rest reported as hidden', () => {
    const units = Array.from({ length: 60 }, (_, i) => step(`s${i}`, [], { files: MIXED }));
    const findings = buildPlanFindings({ units, slotRoutes: slots });
    expect(findings.filter((f) => f.severity === 'warning').length).toBeGreaterThanOrEqual(60);
    const capped = capSquadPlanFindings(findings);
    expect(capped.findings).toHaveLength(50);
    expect(capped.hidden).toBe(findings.length - 50);
  });
});

describe('finding parity for a plan that triggers nothing (REQ-8)', () => {
  const wide = [step('a', [], { files: ['a.txt'], routing: { version: 1 as const, preferRoles: ['nobody'] } }), step('b', [], { files: ['b.txt'] })];
  it('produces exactly the findings it produced before: the prefer-role Check and nothing else', () => {
    const findings = buildPlanFindings({ units: wide, slotRoutes: slots });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ stepId: 'a', requirement: 'prefer-role', severity: 'warning' });
  });
  it('produces exactly the bindings it produced before: no skipsIfFailed on a step without dependents', () => {
    const bindings = planBindings(wide, slots);
    expect(bindings).toEqual([
      { stepId: 'a', slotId: 'w1', label: 'Engineer', personaId: 'builtin:software-engineer' },
      { stepId: 'b', slotId: 'w1', label: 'Engineer', personaId: 'builtin:software-engineer' }
    ]);
    for (const binding of bindings) expect(binding).not.toHaveProperty('skipsIfFailed');
  });
  it('accepts units that carry no dependencies, files or readOnly (older callers) without throwing', () => {
    expect(() => buildPlanFindings({ units: [{ id: 'a', routing: { version: 1 as const } }, { id: 'b' }], slotRoutes: slots })).not.toThrow();
  });
});

describe('design-doc shaped plan (REQ-6)', () => {
  it('builds findings for a 40+ step plan the size of a 45 KB design doc without trouble', () => {
    const units = Array.from({ length: 150 }, (_, i) => step(`step-${i}`, i ? [`step-${i - 1}`] : []));
    const findings = buildPlanFindings({ units, slotRoutes: slots });
    expect(findings).toEqual([expect.objectContaining({ requirement: 'plan', severity: 'warning' })]);
  });
});
