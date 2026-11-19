import { describe, expect, it } from 'vitest';
import { hasPortablePlanStep, parseLaunchSection, parsePortablePlan, PARSER_VERSION } from '../portable-plan.js';
import { launchDigest } from '../../launch/digest.js';
import { COMPATIBILITY_CORPUS } from './golden-corpus.js';

const GOLDEN: Record<string, string> = {
  'vault-contract': 'launch-v1:85108ad40cf041f53e92dd75bdadda9afab8d925a8cf4fc88668183bdf6c3d1b',
  'bare-labels-and-requires': 'launch-v1:44dfd46b5b9561de96b1aebb7f3526636ae9c44ffe530f804eb3a9c1987d4ac6',
  'near-miss-labels': 'launch-v1:958c6f7892befa5d42073246aeff7500e14d0adc24c45f5edbc4242da8e02885'
};
const step = (id: string, body: string) => `### ${id}: Title ${id} <!-- executable-step -->\n${body}\n`;
const parsedOk = (text: string) => {
  const parsed = parsePortablePlan(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return parsed;
};

describe('launch digest compatibility', () => {
  it.each(Object.keys(GOLDEN))('keeps the digest of %s byte-identical', (name) => {
    const parsed = parsedOk(COMPATIBILITY_CORPUS[name]);
    expect(launchDigest(parsed.units)).toBe(GOLDEN[name]);
    expect(JSON.stringify(parsed.units)).not.toMatch(/preferRoles|excludeSameWorkerAs|declaredSquad/);
    expect(parsed.parserVersion).toBe(PARSER_VERSION);
  });
});

describe('Prefer role and Not same worker as', () => {
  const plan = [
    step('a', '- **Work:** one\n- **Verification:** v'),
    step('b', '- **Depends on:** a\n- **Work:** two\n- **Verification:** v'),
    step('c', '- **Depends on:** b\n- **Required role:** Engineer, `Reviewer`\n- **Prefer role:** implement, Implement, review.\n- **Not same worker as:** a, B\n- **Work:** three\n- **Verification:** v')
  ].join('\n');

  it('keeps Required role verbatim and parses the new labels', () => {
    const c = parsedOk(plan.replace('a, B', 'a, b')).units[2];
    expect(c.routing).toEqual({ version: 1, requiredRole: 'Engineer, Reviewer', preferRoles: ['implement', 'Implement', 'review'], excludeSameWorkerAs: ['a', 'b'] });
  });

  it('omits the fields when the labels are empty or None', () => {
    const parsed = parsedOk(step('a', '- **Prefer role:** None\n- **Not same worker as:** None\n- **Work:** x'));
    expect(parsed.units[0].routing).toBeUndefined();
  });

  it('folds near-miss spellings of the new labels', () => {
    const parsed = parsedOk(plan.replace('Prefer role', 'Prefer roles').replace('a, B', 'a'));
    expect(parsed.units[2].routing?.preferRoles).toEqual(['implement', 'Implement', 'review']);
    expect(parsed.normalizations).toContain('step c label "prefer roles" treated as "prefer role"');
  });

  it('rejects a reference that is not a dependency ancestor', () => {
    const text = [step('a', '- **Work:** x'), step('b', '- **Not same worker as:** a\n- **Work:** y')].join('\n');
    expect(parsePortablePlan(text)).toMatchObject({ ok: false, reason: expect.stringContaining('is not a step it depends on'), findings: [{ severity: 'blocking' }] });
  });

  it('rejects an unknown step and a self reference', () => {
    expect(parsePortablePlan(step('a', '- **Not same worker as:** ghost\n- **Work:** y'))).toMatchObject({ ok: false, reason: expect.stringContaining('does not exist') });
    expect(parsePortablePlan(step('a', '- **Not same worker as:** a\n- **Work:** y'))).toMatchObject({ ok: false, reason: expect.stringContaining('is not a step it depends on') });
  });

  it('accepts a transitive ancestor and tolerates a dependency cycle', () => {
    expect(parsePortablePlan(plan.replace('a, B', 'a'))).toMatchObject({ ok: true });
    const cyclic = [step('a', '- **Depends on:** b\n- **Work:** x'), step('b', '- **Depends on:** a\n- **Not same worker as:** a\n- **Work:** y')].join('\n');
    expect(parsePortablePlan(cyclic)).toMatchObject({ ok: true });
  });

  it('rejects a nested near-miss of the hard anti-affinity label', () => {
    const text = step('a', '- **Work:** x\n  - **Not same workers as:** a');
    expect(parsePortablePlan(text)).toMatchObject({ ok: false, reason: expect.stringContaining('unrecognised label') });
  });
});

describe('Squad declaration', () => {
  it('returns declaredSquad outside launch', () => {
    const parsed = parsedOk(`## Launch\n- Squad: \`delivery\`\n\n## Execution Plan\n${step('a', '- **Work:** x')}`);
    expect(parsed.declaredSquad).toBe('delivery');
    expect(parsed.launch).toBeUndefined();
    expect(parseLaunchSection('## Launch\n- Squad: delivery\n- Capabilities: push')).toEqual({ ok: true, launch: { declaredSquad: 'delivery', push: true } });
  });

  it.each(['', 'a'.repeat(300)])('rejects an unusable Squad id', (value) => {
    expect(parseLaunchSection(`## Launch\n- Squad: ${value}`)).toMatchObject({ ok: false });
  });

  it('a Squad declaration in ## Launch does not change launchDigest(units)', () => {
    const body = `## Execution Plan\n${step('a', '- **Work:** x')}`;
    const plain = parsedOk(`## Launch\n- Capabilities: push\n\n${body}`);
    const declared = parsedOk(`## Launch\n- Squad: delivery\n- Capabilities: push\n\n${body}`);
    expect(declared.declaredSquad).toBe('delivery');
    expect(launchDigest(declared.units)).toBe(launchDigest(plain.units));
    expect(JSON.stringify(declared.units)).not.toContain('delivery');
  });

  it('rejects a duplicate Squad declaration', () => {
    expect(parseLaunchSection('## Launch\n- Squad: a\n- Squad: b')).toMatchObject({ ok: false });
  });
});

describe('Execution class normalization', () => {
  it.each([['low', 'Routine'], ['`Medium`', 'Standard'], ['HIGH.', 'Expert'], ['builtin:squad-worker-high', 'Expert']])('reads %s as %s with a warning', (value, tier) => {
    const parsed = parsedOk(step('a', `- **Execution class:** ${value}\n- **Work:** x`));
    expect(parsed.units[0].routing?.minimumLevel).toBeDefined();
    expect(parsed.findings).toEqual([expect.objectContaining({ severity: 'warning', requirement: 'tier', stepId: 'a', message: expect.stringContaining(tier) })]);
  });

  it('stays silent for Routine/Standard/Expert and still rejects unknown classes', () => {
    expect(parsedOk(step('a', '- **Execution class:** Expert\n- **Work:** x')).findings).toBeUndefined();
    expect(parsePortablePlan(step('a', '- **Execution class:** gigantic\n- **Work:** x'))).toMatchObject({ ok: false });
  });
});

describe('formatting deviations become warnings', () => {
  it('keeps Stop conditions as Work guidance and drops an empty value', () => {
    const parsed = parsedOk(step('a', '- **Work:** x\n- Stop conditions: Cannot write.') + step('b', '- **Work:** y\n- Stop conditions:'));
    expect(parsed.units[0].task).toBe('x\n\nStop conditions (guidance, not enforced): Cannot write.');
    expect(parsed.units[1].task).toBe('y');
    expect(parsed.findings).toEqual([expect.objectContaining({ severity: 'warning', stepId: 'a', message: expect.stringContaining('not enforced') })]);
  });

  it('moves free-text Completion criteria into Verification, keeps check lists deterministic', () => {
    const parsed = parsedOk(
      step('a', '- **Work:** x\n- **Verification:** run it\n- **Completion criteria:** File exists.')
      + step('b', '- **Work:** y\n- **Completion criteria:** check:lint, check:tests')
      + step('c', '- **Work:** z\n- **Completion criteria:** None')
    );
    expect(parsed.units[0].verification).toEqual(['run it', 'Completion criteria: File exists.']);
    expect(parsed.units[1]).toMatchObject({ checks: ['lint', 'tests'] });
    expect(parsed.units[2].verification).toBeUndefined();
  });

  it('still rejects duplicate check names and an unterminated fence', () => {
    expect(parsePortablePlan(step('a', '- **Work:** x\n- **Completion criteria:** check:a, check:a'))).toMatchObject({ ok: false });
    expect(parsePortablePlan(step('a', '- **Work:** x\n```sh\necho'))).toMatchObject({ ok: false, reason: expect.stringContaining('unterminated code fence') });
  });

  it('keeps a nested near-miss of a non-safety label as lowercased Work context', () => {
    const parsed = parsedOk(step('a', '- **Work:** x\n  - **Verifications:** Look closely'));
    expect(parsed.units[0].task).toBe('x\n\nverifications: Look closely');
    expect(parsed.findings).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('nested label') })]);
  });

  it('classifies repairs apart from warnings', () => {
    const parsed = parsedOk(step('U1', '- **Work:** x'));
    expect(parsed.findings).toEqual([expect.objectContaining({ severity: 'repair', stepId: 'u1' })]);
  });
});

describe('marker-less steps', () => {
  const doc = '# Doc\n\n## Execution Plan\n\n### one: First\n- **Work:** a\n- **Verification:** v\n\n### two: Second\n- **Depends on:** one\n- **Work:** b\n- **Verification:** v\n\n### notes: Not a step\nJust prose.\n\n## Appendix\n\n### three: Elsewhere\n- **Work:** nope\n';

  it('reads id: Title headings with a Work label under Execution Plan and says how many', () => {
    const parsed = parsedOk(doc);
    expect(parsed.units.map((unit) => unit.id)).toEqual(['one', 'two']);
    expect(parsed.findings).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('2 steps had no <!-- executable-step --> marker') })]);
    expect(hasPortablePlanStep(doc)).toBe(true);
  });

  it('uses marker-less reading only when no step is marked', () => {
    const mixed = `${doc}\n## Execution Plan\n${step('marked', '- **Work:** x')}`;
    expect(parsedOk(mixed).units.map((unit) => unit.id)).toEqual(['marked']);
  });

  it('ignores headings inside code fences and uses singular wording for one step', () => {
    const fenced = '## Execution Plan\n\n```md\n### fake: Heading\n- **Work:** x\n```\n';
    expect(parsePortablePlan(fenced)).toMatchObject({ ok: false, reason: 'no executable steps found' });
    expect(hasPortablePlanStep(fenced)).toBe(false);
    expect(parsedOk('## Execution Plan\n### solo: One\n- **Work:** x').findings?.[0].message).toContain('1 step had no');
  });

  it('does not treat prose as steps', () => {
    expect(hasPortablePlanStep('Please build a thing.')).toBe(false);
    expect(hasPortablePlanStep('## Execution Plan\n### only: Title\nno work label')).toBe(false);
  });

  it('rejects an unterminated fence inside a marker-less step', () => {
    const text = '## Execution Plan\n### a: A\n- **Work:** x\n```sh\nls';
    expect(parsePortablePlan(text)).toMatchObject({ ok: false, reason: expect.stringContaining('unterminated') });
    expect(hasPortablePlanStep(text)).toBe(true);
  });
});

describe('squad-plan block', () => {
  const inner = `## Launch\n- Squad: debug\n\n## Execution Plan\n${step('a', '- **Work:** inside')}`;

  it('takes the fenced block verbatim and ignores the surrounding document', () => {
    const text = `Intro\n${step('x', '- **Work:** outside')}\n\`\`\`squad-plan\n${inner}\n\`\`\`\n\nOutro`;
    const parsed = parsedOk(text);
    expect(parsed.units.map((unit) => unit.id)).toEqual(['a']);
    expect(parsed.declaredSquad).toBe('debug');
    expect(hasPortablePlanStep(text)).toBe(true);
  });

  it('uses the first of several blocks and warns', () => {
    const block = (id: string) => `~~~squad-plan\n${step(id, '- **Work:** x')}\n~~~\n`;
    const parsed = parsedOk(`${block('first')}\n${block('second')}`);
    expect(parsed.units.map((unit) => unit.id)).toEqual(['first']);
    expect(parsed.findings).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringContaining('2 squad-plan blocks') })]);
  });

  it('rejects an unclosed block', () => {
    expect(parsePortablePlan('```squad-plan\n### a: A <!-- executable-step -->\n- **Work:** x')).toMatchObject({ ok: false, reason: expect.stringContaining('not closed') });
  });
});

describe('failure metadata', () => {
  it('stamps parserVersion and a blocking finding on every failure', () => {
    expect(parsePortablePlan('')).toEqual({ ok: false, reason: 'empty plan text', parserVersion: PARSER_VERSION, findings: [{ severity: 'blocking', requirement: 'plan', message: 'empty plan text' }] });
  });
});
