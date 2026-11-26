import { describe, expect, it } from 'vitest';
import { parsePortablePlan, type PortablePlanWorkUnitInput } from '../portable-plan.js';
import { renderCanonicalPlan } from '../portable-plan-render.js';
import { launchDigest } from '../../launch/digest.js';

const parseUnits = (text: string): PortablePlanWorkUnitInput[] => {
  const parsed = parsePortablePlan(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.units;
};

const FULL = `## Execution Plan

### Plan-A: Inspect <!-- executable-step -->
- **Depends on:** None
- **Execution class:** high
- **Required role:** reviewer
- **Prefer role:** writer, editor
- **Mode:** read-only
- **Write scope:** None
- **Work:** Look at the code.
  Then report.
- **Verification:** Read it twice.
- **Completion criteria:** The report is clear.
- **Stop conditions:** Stop after an hour.

### build: Build it <!-- executable-step -->
- **Depends on:** plan-a
- **Not same worker as:** plan-a
- **Write scope:** src/a.ts, src/b.ts
- **Work:** Make the change.
- **Completion criteria:** check:unit, check:lint
- **Requires:** Skills: alpha, beta; MCP servers: repo
- **On failure:** retry build up to 2 with feedback
- **maxIterations:** 3

### review: Review it <!-- executable-step -->
- **Depends on:** build
- **Work:** Review.
- **Loop:** build until PASS, max 2
`;

describe('renderCanonicalPlan', () => {
  it('renders the normalized grammar (golden)', () => {
    const text = renderCanonicalPlan(parseUnits(FULL), { declaredSquad: 'core' });
    expect(text).toMatchInlineSnapshot(`
      "## Launch
      - **Squad:** core

      ## Execution Plan

      ### plan-a: Inspect <!-- executable-step -->
      - **Depends on:** None
      - **Execution class:** Expert
      - **Required role:** reviewer
      - **Prefer role:** writer, editor
      - **Mode:** read-only
      - **Write scope:** None
      - **Work:** Look at the code.
        Then report.

      Stop conditions (guidance, not enforced): Stop after an hour.
      - **Verification:** Read it twice.
      - **Completion criteria:** The report is clear.

      ### build: Build it <!-- executable-step -->
      - **Depends on:** plan-a
      - **Not same worker as:** plan-a
      - **Write scope:** src/a.ts, src/b.ts
      - **Work:** Make the change.
      - **Completion criteria:** check:unit, check:lint
      - **Requires:** Skills: alpha, beta; MCP servers: repo
      - **On failure:** retry build up to 2 with feedback
      - **maxIterations:** 3

      ### review: Review it <!-- executable-step -->
      - **Depends on:** build
      - **Write scope:** None
      - **Work:** Review.
      - **Loop:** build until PASS, max 2
      "
    `);
  });

  it('round-trips to the same work units and launch digest', () => {
    const units = parseUnits(FULL);
    const text = renderCanonicalPlan(units, { declaredSquad: 'core' });
    expect(text).toBeDefined();
    const again = parsePortablePlan(text!);
    expect(again.ok && launchDigest(again.units)).toBe(launchDigest(units));
    expect(again.ok && again.declaredSquad).toBe('core');
    expect(renderCanonicalPlan(again.ok ? again.units : [], { declaredSquad: 'core' })).toBe(text);
  });

  it('is a fixed point for a clean plan and leaves the digest of the original untouched', () => {
    const clean = '### one: One <!-- executable-step -->\n- **Depends on:** None\n- **Write scope:** None\n- **Work:** Do it.\n';
    const units = parseUnits(clean);
    const before = launchDigest(units);
    const text = renderCanonicalPlan(units);
    expect(launchDigest(units)).toBe(before);
    expect(launchDigest(parseUnits(text!))).toBe(before);
  });

  it('shows the plan the Squad will run for marker-less, tier-name input', () => {
    const units = parseUnits('## Execution Plan\n\n### a: A\n- **Work:** x\n- **Execution class:** `medium`\n');
    const text = renderCanonicalPlan(units)!;
    expect(text).toContain('<!-- executable-step -->');
    expect(text).toContain('**Execution class:** Standard');
  });

  it('returns undefined for no steps, over the byte cap, or text that would not re-parse identically', () => {
    expect(renderCanonicalPlan([])).toBeUndefined();
    expect(renderCanonicalPlan(parseUnits(FULL), { maxBytes: 10 })).toBeUndefined();
    const [unit] = parseUnits('### a: A <!-- executable-step -->\n- **Work:** x\n');
    expect(renderCanonicalPlan([{ ...unit, files: ['a,b'] }])).toBeUndefined();
    expect(renderCanonicalPlan([unit])).toBeDefined();
  });
});
