import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../portable-plan.js';
import { requirementFailureFromAdmission } from '../service.js';
import { evaluateTeamAdmission } from '../../launch/preflight.js';

/** Sample plans from the manual plan test document: pasted verbatim as a goal. */
const step = (id: string, title: string, depends: string, requires?: string) => `### ${id}: ${title} <!-- executable-step -->
- **Depends on:** ${depends}
${requires ? `- **Requires:** ${requires}\n` : ''}- **Write scope:** \`${id}.md\`
- **Work:** Do ${id}.
- **Verification:** Read ${id}.md.
`;

const plan = (requires?: string) => `## Execution Plan\n\n${step('write-note', 'Write a note', 'None', requires)}\n${step('review-note', 'Review the note', 'write-note')}`;

const inventory = (skills: Array<[string, boolean]>, mcp: Array<[string, boolean]>) => ({
  version: 1 as const, observedAt: 10, maxAgeMs: 100,
  skills: skills.map(([name, available]) => ({ name, available })),
  mcpServers: mcp.map(([name, available]) => ({ name, available })),
  models: [], providers: []
});

const admit = (text: string, inv: ReturnType<typeof inventory>) => {
  const parsed = parsePortablePlan(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  const admission = evaluateTeamAdmission({
    workUnits: parsed.units, requireCompletePlan: true, slotCount: 1, maxSlots: 1, initialTasks: ['work'], now: 10, inventory: inv
  });
  return { parsed, admission, failure: requirementFailureFromAdmission(parsed.units, admission) };
};

describe('portable plan Requires syntax', () => {
  it.each([
    ['skills only, lower-case label', 'skills: alpha', { skills: ['alpha'] }],
    ['skills in backticks', 'Skills: `alpha`, `beta`', { skills: ['alpha', 'beta'] }],
    ['MCP servers only', 'MCP servers: repo', { mcpServers: ['repo'] }],
    ['mcpservers without space', 'McpServers: repo', { mcpServers: ['repo'] }],
    ['both categories', 'Skills: `alpha`; MCP servers: `repo`, `browser`', { skills: ['alpha'], mcpServers: ['repo', 'browser'] }],
    ['None literal', 'None', undefined],
    ['backticked none', '`none`', undefined],
    ['none entries inside a list', 'Skills: none; MCP servers: none', undefined]
  ])('resolves %s', (_label, line, expected) => {
    const parsed = parsePortablePlan(plan(line));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.units[0]?.requires).toEqual(expected);
    expect(parsed.units[1]?.requires).toBeUndefined();
  });

  it('omits requires when the label is absent', () => {
    const parsed = parsePortablePlan(plan());
    expect(parsed.ok && parsed.units.every((unit) => unit.requires === undefined)).toBe(true);
  });

  it.each([
    ['unknown category', 'Widgets: foo', 'Widgets: foo'],
    ['missing colon', 'skills no-such-skill', 'skills no-such-skill'],
    ['unknown segment after a valid one', 'Skills: a; Foo: b', 'Foo: b'],
    ['unknown segment before a valid one', 'Foo: b; Skills: a', 'Foo: b']
  ])('rejects a malformed Requires line (%s) naming unit and text', (_label, line, offending) => {
    const parsed = parsePortablePlan(plan(line));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('write-note');
    expect(parsed.reason).toContain(offending);
  });

  it('tolerates trailing semicolons and blank entries', () => {
    const parsed = parsePortablePlan(plan('Skills: a;; '));
    expect(parsed.ok && parsed.units[0]?.requires).toEqual({ skills: ['a'] });
  });
});

describe('requirement rejection before launch (admission)', () => {
  it('rejects with only the missing names; available inventory entries are not listed', () => {
    const { admission, failure } = admit(
      plan('Skills: `real-skill`, `no-such-skill`; MCP servers: `real-server`, `no-such-server`'),
      inventory([['real-skill', true], ['no-such-skill', false]], [['real-server', true], ['no-such-server', false]])
    );
    expect(admission.ready).toBe(false);
    expect(failure).toEqual({
      workUnits: [{ id: 'write-note', title: 'Write a note', missingSkills: ['no-such-skill'], missingMcpServers: ['no-such-server'] }]
    });
  });

  it('treats a skill absent from the inventory as missing', () => {
    const { failure } = admit(plan('skills: no-such-skill'), inventory([['other', true]], []));
    expect(failure?.workUnits[0]).toMatchObject({ id: 'write-note', missingSkills: ['no-such-skill'], missingMcpServers: [] });
  });

  it('admits when every declared requirement is available', () => {
    const { admission, failure } = admit(
      plan('Skills: `real-skill`; MCP servers: `real-server`'),
      inventory([['real-skill', true]], [['real-server', true]])
    );
    expect(admission.ready).toBe(true);
    expect(failure).toBeUndefined();
  });

  it('admits `Requires: None` regardless of inventory', () => {
    const { admission, failure } = admit(plan('None'), inventory([], []));
    expect(admission.ready).toBe(true);
    expect(failure).toBeUndefined();
  });

  it('does not blame named capabilities when the inventory is stale (no verified gap)', () => {
    const parsed = parsePortablePlan(plan('skills: real-skill'));
    if (!parsed.ok) throw new Error(parsed.reason);
    const admission = evaluateTeamAdmission({
      workUnits: parsed.units, requireCompletePlan: true, slotCount: 1, maxSlots: 1, initialTasks: ['work'], now: 10_000,
      inventory: inventory([['real-skill', false]], [])
    });
    expect(admission.ready).toBe(false);
    expect(requirementFailureFromAdmission(parsed.units, admission)).toBeUndefined();
  });
});
