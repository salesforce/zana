import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`./builtin-skills/${path}`, import.meta.url), 'utf8');
const brainstorm = read('brainstorm/SKILL.md');
const inbox = read('zcc-inbox/SKILL.md');
const squads = read('zcc-inbox/references/squads.md');

describe('squad proposal skills', () => {
  it('keeps the brainstorm proposal flow intact', () => {
    expect(brainstorm).toContain('## When the user wants it built');
    expect(brainstorm).toContain('mcp__zcc-inbox__squad_plan_check');
    expect(brainstorm).toContain('mcp__zcc-inbox__squad_launch');
    expect(brainstorm).toContain('[Squad report]');
  });

  it('routes durable Squad detail to the snapshot-local reference', () => {
    expect(inbox).toContain('`references/squads.md`');
    expect(inbox).toContain('do not preload detailed schemas or examples');
    expect(squads).toContain('`squad_plan_check`');
    expect(squads).toContain('`squad_launch`');
    expect(squads).toContain("`mode: 'review'");
    expect(squads).toContain("`mode: 'now'");
    expect(squads).toContain('`execution.snapshot`');
    expect(squads).toContain('execution_respond({');
  });
});
