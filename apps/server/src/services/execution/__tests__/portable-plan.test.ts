import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';
import { normalizeExecutionPlan } from '../../launch/preflight.js';

const CANONICAL = `# Minimal Workflow Execution Probe

## Execution Plan

| Execution Class | Meaning |
|---|---|
| Routine | ... |

### home: Write Home Probe Output <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Routine
- **Mode:** Mutating
- **Read scope:** None
- **Write scope:** \`home.txt\`
- **Excludes:** \`about.txt\`, \`result.txt\`
- **Work:** Create \`home.txt\` containing exactly \`HOME: ready\`.
- **Verification:** Read \`home.txt\` and confirm exact content.
- **Completion criteria:** File exists.
- **Stop conditions:** Cannot write.
- **Outputs / handoff:** Content.

### about: Write About Probe Output <!-- executable-step -->

- **Depends on:** None
- **Execution class:** Routine
- **Mode:** Mutating
- **Write scope:** \`about.txt\`
- **Work:** Create \`about.txt\`.
- **Verification:** Read \`about.txt\`.

### navigation-label: Ask Human Navigation Label <!-- executable-step -->

- **Depends on:** \`home\`, \`about\`
- **Execution class:** Routine
- **Mode:** Read-only
- **Write scope:** None
- **Work:** Raise a durable human decision blocker.
- **Verification:** Job Details shows one blocked question.

### assemble: Assemble Final Probe Result <!-- executable-step -->

- **Depends on:** \`navigation-label\`
- **Execution class:** Expert
- **Mode:** Mutating
- **Read scope:** \`home.txt\`, \`about.txt\`
- **Write scope:** \`result.txt\`
- **Work:** Read both files and write \`result.txt\`.
- **Verification:** \`cat result.txt\` prints expected lines.

## Verification Matrix
`;

describe('parsePortablePlan', () => {
  it('parses the canonical four-step probe plan into work units', () => {
    const result = parsePortablePlan(CANONICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units.map((u) => u.id)).toEqual(['home', 'about', 'navigation-label', 'assemble']);

    const home = result.units[0];
    expect(home.title).toBe('Write Home Probe Output');
    expect(home.dependencies).toEqual([]);
    expect(home.files).toEqual(['home.txt']);
    expect(home.verification).toEqual(['Read `home.txt` and confirm exact content.']);
    expect(home.readOnly).toBeUndefined();
    expect(home.routing).toEqual({ version: 1, minimumLevel: 'low' });

    const nav = result.units[2];
    expect(nav.dependencies).toEqual(['home', 'about']);
    expect(nav.readOnly).toBe(true);
    expect(nav.files).toBeUndefined();

    const assemble = result.units[3];
    expect(assemble.dependencies).toEqual(['navigation-label']);
    expect(assemble.files).toEqual(['result.txt']);
    expect(assemble.routing).toEqual({ version: 1, minimumLevel: 'high' });
  });

  it('produces units that pass durable completeness normalization', () => {
    const result = parsePortablePlan(CANONICAL);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(() => normalizeExecutionPlan(result.units, true)).not.toThrow();
    const normalized = normalizeExecutionPlan(result.units, true);
    expect(normalized).toHaveLength(4);
  });

  it('rejects text with no executable-step markers', () => {
    const result = parsePortablePlan('# Plan\n\n### home: Write\n\n- **Work:** do it\n');
    expect(result).toEqual({ ok: false, reason: 'no executable steps found' });
  });

  it('rejects empty text', () => {
    expect(parsePortablePlan('   ')).toEqual({ ok: false, reason: 'empty plan text' });
  });

  it('fails when a step is missing Work', () => {
    const text = '### home: Title <!-- executable-step -->\n\n- **Depends on:** None\n';
    const result = parsePortablePlan(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('missing Work');
  });

  it('fails on an invalid (non-kebab) step id', () => {
    const text = '### Home Step: Title <!-- executable-step -->\n\n- **Work:** do it\n';
    const result = parsePortablePlan(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('invalid step id');
  });

  it('treats a step with no Depends on / Write scope as a dependency-free read step', () => {
    const text = '### solo: Solo <!-- executable-step -->\n\n- **Mode:** Read-only\n- **Work:** inspect only\n';
    const result = parsePortablePlan(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units[0]).toMatchObject({ id: 'solo', dependencies: [], readOnly: true });
    expect(result.units[0].files).toBeUndefined();
  });
});
