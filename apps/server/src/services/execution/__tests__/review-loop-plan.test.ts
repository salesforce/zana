import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';
import { normalizeExecutionPlan } from '../../launch/preflight.js';
import { LOOP_VERDICT_OUTPUT } from '../contracts.js';

// #583 review loop: parsing (REQ-1, REQ-2), validation (REQ-3), typed verdict declaration (REQ-4).

const step = (id: string, depends: string, extra = '') => `### ${id}: Title ${id} <!-- executable-step -->
- **Depends on:** ${depends}
- **Write scope:** \`${id}.md\`
- **Work:** Do ${id}.
- **Verification:** Read ${id}.md.
${extra}`;

const loopPlan = (loopValue: string | null, bold = true) => {
  const label = loopValue === null ? '' : bold ? `- **Loop:** ${loopValue}\n` : `- Loop: ${loopValue}\n`;
  return `## Execution Plan\n\n${step('build', 'None')}\n${step('review', 'build', label)}\n${step('fix', 'review')}\n${step('accept', 'fix')}`;
};

const parse = (text: string) => parsePortablePlan(text);
const unitOf = (text: string, id: string) => {
  const parsed = parse(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed.units.find((u) => u.id === id)!;
};

describe('REQ-1 plans without Loop are unchanged', () => {
  it('parses a no-Loop plan into units with no loop key and the exact legacy shape', () => {
    const parsed = parse(loopPlan(null));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.units.map((u) => u.id)).toEqual(['build', 'review', 'fix', 'accept']);
    for (const unit of parsed.units) expect('loop' in unit).toBe(false);
    expect(parsed.units[1]).toEqual({
      id: 'review', title: 'Title review', task: 'Do review.', dependencies: ['build'],
      files: ['review.md'], verification: ['Read review.md.']
    });
  });

  it('normalises a no-Loop plan twice to the same value with no loop and no generated output', () => {
    const parsed = parse(loopPlan(null));
    if (!parsed.ok) throw new Error(parsed.reason);
    const once = normalizeExecutionPlan(parsed.units, true);
    expect(normalizeExecutionPlan(once, true)).toEqual(once);
    for (const unit of once) { expect(unit.loop).toBeUndefined(); expect(unit.output).toBeUndefined(); }
  });

  it('keeps a plain-bullet "- Loop: poll every 5 min" inside Work as Work text', () => {
    const text = `## Execution Plan\n\n### poller: Poll <!-- executable-step -->\n- **Depends on:** None\n- **Write scope:** \`p.md\`\n- **Work:** Watch the build.\n- Loop: poll every 5 min\n- **Verification:** Read p.md.\n`;
    const unit = unitOf(text, 'poller');
    expect(unit.loop).toBeUndefined();
    expect(unit.task).toContain('Loop: poll every 5 min');
  });
});

describe('REQ-2 Loop label grammar', () => {
  it.each([
    ['fix until PASS, max 3', 3],
    ['fix until PASS, max 1', 1],
    ['fix until PASS, max 5', 5]
  ])('parses "%s" into a versioned loop', (value, max) => {
    expect(unitOf(loopPlan(value), 'review').loop).toEqual({ version: 1, fixUnitId: 'fix', until: 'PASS', max });
  });

  it('parses the plain-bullet form when its first line matches the grammar', () => {
    expect(unitOf(loopPlan('fix until PASS, max 2', false), 'review').loop).toEqual({ version: 1, fixUnitId: 'fix', until: 'PASS', max: 2 });
  });

  it.each([
    ['max 0', 'fix until PASS, max 0'],
    ['max 6', 'fix until PASS, max 6'],
    ['no max', 'fix until PASS'],
    ['wrong keyword', 'fix until DONE, max 2'],
    ['no id', 'until PASS, max 2'],
    ['free text', 'keep going until it is good']
  ])('fails a bold Loop label with %s, naming the unit and the expected form', (_name, value) => {
    const parsed = parse(loopPlan(value));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('review');
    expect(parsed.reason).toMatch(/until PASS, max/);
  });

  it('fails a nested Loop label with the same message', () => {
    const text = loopPlan(null).replace('- **Write scope:** `review.md`', '- **Write scope:** `review.md`\n  - **Loop:** fix until PASS, max 2');
    const parsed = parse(text);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toMatch(/review[\s\S]*until PASS, max/);
  });
});

describe('REQ-3 Loop validation', () => {
  const unit = (id: string, dependencies: string[], loop?: { version: 1; fixUnitId: string; until: 'PASS'; max: number }) =>
    ({ id, title: id, task: `do ${id}`, dependencies, readOnly: true, ...(loop ? { loop } : {}) });
  const loop = (fixUnitId: string, max = 2) => ({ version: 1 as const, fixUnitId, until: 'PASS' as const, max });

  it('accepts a valid loop', () => {
    const units = normalizeExecutionPlan([unit('r', [], loop('f')), unit('f', ['r'])]);
    expect(units[0].loop).toEqual(loop('f'));
  });

  it.each([
    ['fix unit does not exist', () => [unit('r', [], loop('nope'))]],
    ['fix unit does not depend on the review', () => [unit('r', [], loop('f')), unit('f', [])]],
    ['fix unit is the target of two loops', () => [unit('r1', [], loop('f')), unit('r2', [], loop('f')), unit('f', ['r1', 'r2'])]],
    ['max below 1', () => [unit('r', [], loop('f', 0)), unit('f', ['r'])]],
    ['max above 5', () => [unit('r', [], loop('f', 6)), unit('f', ['r'])]],
    ['max not an integer', () => [unit('r', [], loop('f', 1.5)), unit('f', ['r'])]],
    ['review targets itself', () => [unit('r', [], loop('r'))]],
    ['fix unit loops back at the review', () => [unit('r', [], loop('f')), unit('f', ['r'], loop('r'))]]
  ])('rejects: %s', (_name, build) => {
    expect(() => normalizeExecutionPlan(build())).toThrow(/loop/i);
  });

  it('keeps loop in the normalised unit with a fixed key order', () => {
    const [review] = normalizeExecutionPlan([unit('r', [], { max: 2, until: 'PASS', fixUnitId: 'f', version: 1 }), unit('f', ['r'])]);
    expect(Object.keys(review.loop!)).toEqual(['version', 'fixUnitId', 'until', 'max']);
  });
});

describe('REQ-4 typed verdict declaration', () => {
  const unit = (id: string, dependencies: string[], extra: Record<string, unknown> = {}) => ({ id, title: id, task: `do ${id}`, dependencies, readOnly: true, ...extra });
  const loop = { version: 1 as const, fixUnitId: 'f', until: 'PASS' as const, max: 2 };

  it('generates the verdict output for a loop unit without output, and is idempotent', () => {
    const once = normalizeExecutionPlan([unit('r', [], { loop }), unit('f', ['r'])]);
    expect(once[0].output).toEqual(LOOP_VERDICT_OUTPUT);
    expect(normalizeExecutionPlan(once)).toEqual(once);
  });

  it('keeps the loop and adds no output to the fix unit', () => {
    const units = normalizeExecutionPlan([unit('r', [], { loop }), unit('f', ['r'])]);
    expect(units[0].loop).toEqual(loop);
    expect(units[1].output).toBeUndefined();
  });

  it('accepts an own output whose verdict matches the enum and is required', () => {
    const output = { version: 1 as const, schema: { type: 'object' as const, properties: { verdict: { type: 'string' as const, enum: ['PASS', 'CHANGES'] }, notes: { type: 'string' as const } }, required: ['verdict'] } };
    const units = normalizeExecutionPlan([unit('r', [], { loop, output }), unit('f', ['r'])]);
    expect(units[0].loop).toEqual(loop);
    expect(units[0].output).toEqual(output);
  });

  it.each([
    ['verdict not required', { properties: { verdict: { type: 'string', enum: ['PASS', 'CHANGES'] } }, required: [] }],
    ['verdict enum differs', { properties: { verdict: { type: 'string', enum: ['PASS', 'MAYBE'] } }, required: ['verdict'] }],
    ['no verdict property', { properties: { other: { type: 'string' } }, required: ['other'] }]
  ])('rejects an own output where %s', (_name, schema) => {
    const output = { version: 1 as const, schema: { type: 'object' as const, ...schema } };
    expect(() => normalizeExecutionPlan([unit('r', [], { loop, output } as never), unit('f', ['r'])])).toThrow();
  });
});

describe('REQ-3 / REQ-6 loop-control deadlock (CodeNod COR-002, OBL-004)', () => {
  const u = (id: string, dependencies: string[], loop?: { version: 1; fixUnitId: string; until: 'PASS'; max: number }) =>
    ({ id, title: id, task: `do ${id}`, dependencies, readOnly: true, ...(loop ? { loop } : {}) });

  it('rejects a fix unit that depends on another dependant of its review, which waits for PASS and so can never run before the fix', () => {
    expect(() => normalizeExecutionPlan([
      u('r', [], { version: 1, fixUnitId: 'f', until: 'PASS', max: 2 }),
      u('d', ['r']),
      u('f', ['r', 'd'])
    ])).toThrow(/loop/i);
  });

  it('rejects two loops whose fix units each wait for the other review to pass', () => {
    expect(() => normalizeExecutionPlan([
      u('r1', [], { version: 1, fixUnitId: 'f1', until: 'PASS', max: 2 }),
      u('r2', [], { version: 1, fixUnitId: 'f2', until: 'PASS', max: 2 }),
      u('f1', ['r1', 'r2']),
      u('f2', ['r1', 'r2'])
    ])).toThrow(/loop/i);
  });

  it('rejects a fix unit that carries a loop of its own (chained loops)', () => {
    expect(() => normalizeExecutionPlan([
      u('r1', [], { version: 1, fixUnitId: 'r2', until: 'PASS', max: 2 }),
      u('r2', ['r1'], { version: 1, fixUnitId: 'f', until: 'PASS', max: 2 }),
      u('f', ['r2'])
    ])).toThrow(/nested|loop/i);
  });

  it('still accepts a plain review, fix and acceptance chain', () => {
    expect(() => normalizeExecutionPlan([
      u('r', [], { version: 1, fixUnitId: 'f', until: 'PASS', max: 2 }),
      u('f', ['r']),
      u('a', ['f'])
    ])).not.toThrow();
  });
});
