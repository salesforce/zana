import { describe, expect, it } from 'vitest';
import { normalizeStepId, parsePortablePlan } from '../portable-plan.js';
import { launchDigest } from '../../launch/digest.js';

const step = (id: string, extra = '- **Work:** Do it.') => `### ${id}: Title ${id} <!-- executable-step -->\n${extra}\n`;

describe('normalizeStepId', () => {
  it.each(['u1', 'home-step', 'a--b', '0abc', 'a-', 'x9-y'])('is the identity on valid id %s', (id) => {
    expect(normalizeStepId(id)).toBe(id);
  });

  it.each([
    ['U1', 'u1'],
    ['Home Step', 'home-step'],
    ['  Foo__Bar!! ', 'foo-bar'],
    ['A--B C', 'a-b-c'],
    ['--x--', 'x'],
    ['---', '']
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeStepId(raw)).toBe(expected);
  });

  it('is idempotent', () => {
    for (const raw of ['U1', 'Home Step', 'A--B C', '--x--', 'ok-id', 'a--b']) {
      const once = normalizeStepId(raw);
      expect(normalizeStepId(once)).toBe(once);
    }
  });
});

describe('portable plan id normalization', () => {
  const plan = [
    step('U1'),
    step('U2', '- **Depends on:** U1, `U0`\n- **Work:** Do it.')
  ].join('\n');

  it('accepts an uppercase id, normalizes dependencies, and records each repair', () => {
    const parsed = parsePortablePlan(plan);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.units.map((unit) => unit.id)).toEqual(['u1', 'u2']);
    expect(parsed.units[1].dependencies).toEqual(['u1', 'u0']);
    expect(parsed.normalizations).toEqual([
      'step "U1" id normalized to "u1"',
      'step "U2" id normalized to "u2"',
      'step u2 dependency "U1" normalized to "u1"',
      'step u2 dependency "U0" normalized to "u0"'
    ]);
  });

  it('keeps an unrepairable dependency reference as written', () => {
    const parsed = parsePortablePlan(step('a', '- **Depends on:** ---\n- **Work:** Do it.'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.units[0].dependencies).toEqual(['---']);
      expect(parsed.normalizations).toBeUndefined();
    }
  });

  it('fails when two distinct raw ids normalize to the same id', () => {
    for (const [first, second] of [['U1', 'u1'], ['U1', 'U1'], ['A B', 'a-b']]) {
      const parsed = parsePortablePlan(`${step(first)}\n${step(second)}`);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.reason).toBe(`step ids "${first}" and "${second}" both normalize to "${normalizeStepId(first)}"`);
    }
  });

  it('lets a verbatim repeated valid id through for the DAG check to reject', () => {
    const parsed = parsePortablePlan(`${step('a')}\n${step('a')}`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.units.map((unit) => unit.id)).toEqual(['a', 'a']);
  });

  it('fails on conflicting near-miss labels for the same canonical label', () => {
    const parsed = parsePortablePlan(step('u1', '- **Depends on:** None\n- **Depend on:** b\n- **Work:** Do it.'));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toBe('step u1 has conflicting labels "depends on" and "depend on" (both read as "depends on")');
  });

  it('exposes only step id renames as structured idRenames', () => {
    const parsed = parsePortablePlan(plan);
    expect(parsed.ok && parsed.idRenames).toEqual([{ from: 'U1', to: 'u1' }, { from: 'U2', to: 'u2' }]);
    const depOnly = parsePortablePlan(`${step('u1')}\n${step('u2', '- **Depends on:** U1\n- **Work:** Do it.')}`);
    expect(depOnly.ok).toBe(true);
    if (depOnly.ok) {
      expect(depOnly.normalizations).toEqual(['step u2 dependency "U1" normalized to "u1"']);
      expect(depOnly).not.toHaveProperty('idRenames');
    }
    const folded = parsePortablePlan(step('u1', '- **Depend on:** b\n- **Work:** Do it.'));
    expect(folded.ok && 'idRenames' in folded).toBe(false);
  });

  it('records a folded near-miss label', () => {
    const parsed = parsePortablePlan(step('u1', '- **Depend on:** b\n- **Work:** Do it.'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.units[0].dependencies).toEqual(['b']);
      expect(parsed.normalizations).toEqual(['step u1 label "depend on" treated as "depends on"']);
    }
  });
});

describe('portable plan execution class pinning', () => {
  const withClass = (value: string) => step('a', `- **Execution class:** ${value}\n- **Work:** Do it.`);

  it.each(['Wizard', 'low', 'constructor', 'toString', '`high`x'])('fails loudly on unmapped class %s', (value) => {
    const parsed = parsePortablePlan(withClass(value));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toContain('step a: could not pin minimumLevel for execution class');
      expect(parsed.reason).toContain('(expected Routine, Standard, or Expert)');
    }
  });

  it.each([
    ['EXPERT', 'high'],
    ['`Expert`', 'high'],
    ['Standard', 'medium'],
    ['routine', 'low'],
    ['builtin:squad-worker-low', 'low'],
    ['builtin:squad-worker-medium', 'medium'],
    ['builtin:squad-worker-high', 'high']
  ])('accepts %s', (value, level) => {
    const parsed = parsePortablePlan(withClass(value));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.units[0].routing).toMatchObject({ minimumLevel: level });
  });

  it.each([
    ['Routine.', 'low'],
    ['`Expert`.', 'high'],
    ['Standard\n  because the change spans two packages', 'medium'],
    ['Routine.\n  Wizard-level prose on a continuation line.', 'low']
  ])('accepts sentence-style or multi-line class %j', (value, level) => {
    const parsed = parsePortablePlan(withClass(value));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.units[0].routing).toMatchObject({ minimumLevel: level });
  });

  it('names the first-line class, without its sentence period, when it is unmapped', () => {
    const parsed = parsePortablePlan(withClass('Wizard.\n  more prose'));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('step a: could not pin minimumLevel for execution class "Wizard" (expected Routine, Standard, or Expert)');
    }
  });

  it('accepts an absent class without a minimumLevel', () => {
    const parsed = parsePortablePlan(step('a'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.units[0].routing?.minimumLevel).toBeUndefined();
  });
});

describe('portable plan near-miss label indent', () => {
  it('folds a near-miss at the step label indent and records it', () => {
    const parsed = parsePortablePlan(step('a', '- **Work:** Do it.\n- **Completion criterion:** tests pass'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.units[0].task).toBe('Do it.');
      expect(parsed.normalizations).toEqual(['step a label "completion criterion" treated as "completion criteria"']);
    }
  });

  it('fails a nested bold near-miss under Work with the unrecognised-label reason', () => {
    const parsed = parsePortablePlan(step('a', '- **Work:**\n  Do it.\n  - **Completion criterion:** tests pass\n- **Verification:** Read it.'));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.reason).toBe('step a has unrecognised label "completion criterion" (did you mean "completion criteria"?)');
    }
  });

  it('keeps a nested plain near-miss bullet as Work continuation text', () => {
    const parsed = parsePortablePlan(step('a', '- **Work:**\n  Do it.\n  - Completion criterion: tests pass'));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.units[0].task).toBe('Do it.\n  - Completion criterion: tests pass');
      expect(parsed.normalizations).toBeUndefined();
    }
  });
});

describe('portable plan digest stability', () => {
  it('re-parsing the same normalized text yields identical units and digest', () => {
    const text = `${step('U1')}\n${step('U2', '- **Depends on:** U1\n- **Work:** Do it.')}`;
    const first = parsePortablePlan(text);
    const second = parsePortablePlan(text);
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) expect(launchDigest(first.units)).toBe(launchDigest(second.units));
  });

  it('normalized ids digest the same as the already-kebab plan', () => {
    const upper = parsePortablePlan(step('U1'));
    const lower = parsePortablePlan(step('u1').replace('Title u1', 'Title U1'));
    expect(upper.ok && lower.ok).toBe(true);
    if (upper.ok && lower.ok) expect(launchDigest(upper.units)).toBe(launchDigest(lower.units));
  });

  it('leaves a clean plan with no normalizations key and exact units', () => {
    const parsed = parsePortablePlan(step('a-b', '- **Depends on:** None\n- **Write scope:** `x.md`\n- **Work:** Do it.\n- **Verification:** Read x.'));
    expect(parsed).toEqual({
      ok: true,
      units: [{
        id: 'a-b',
        title: 'Title a-b',
        task: 'Do it.',
        dependencies: [],
        files: ['x.md'],
        verification: ['Read x.']
      }]
    });
    expect(parsed.ok && 'normalizations' in parsed).toBe(false);
  });
});
