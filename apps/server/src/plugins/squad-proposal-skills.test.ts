import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePortablePlan } from '../services/execution/portable-plan.js';

const read = (path: string) => readFileSync(new URL(`./builtin-skills/${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const brainstorm = read('brainstorm/SKILL.md');
const inbox = read('zcc-inbox/SKILL.md');
const inboxReferences = ['inbox.md', 'library.md', 'remote.md', 'schedules.md', 'squads.md'];
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

  it('links every extracted zcc-inbox reference from its compact core skill', () => {
    for (const name of inboxReferences) {
      expect(inbox).toContain(`\`references/${name}\``);
      expect(read(`zcc-inbox/references/${name}`)).not.toHaveLength(0);
    }
  });

  describe('brainstorm plan-authoring reference', () => {
    const authoring = read('brainstorm/references/plan-authoring.md');
    const example = /```squad-plan\n([\s\S]*?)\n```\n/.exec(authoring)?.[1] ?? '';

    it('is linked from a brainstorm trigger row', () => {
      expect(brainstorm).toContain('`references/plan-authoring.md`');
    });

    it('describes both flows, the roster tool and both checks', () => {
      for (const needle of ['design_doc_read', 'attachments', 'list_teams', 'squad_plan_check', "mode: 'review'", 'teamId', 'Never assume']) {
        expect(authoring).toContain(needle);
      }
      expect(authoring).not.toMatch(/Workspace/);
    });

    it('ships an example the parser accepts, with every routing label and the Launch Squad', () => {
      const parsed = parsePortablePlan(example);
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(parsed.units.map((unit) => unit.id)).toEqual(['find-callers', 'change-parser', 'review-parser']);
      expect(parsed.declaredSquad).toBe('delivery');
      const routing = parsed.units.map((unit) => unit.routing);
      expect(routing[1]?.preferRoles).toEqual(['Engineer']);
      expect(routing[2]?.requiredRole).toBe('Reviewer');
      expect(routing[2]?.excludeSameWorkerAs).toEqual(['change-parser']);
    });

    it('names every routing label the parser reads', () => {
      for (const label of ['Required role', 'Prefer role', 'Not same worker as', 'Squad:', 'Execution class', 'Requires', 'Loop']) {
        expect(authoring).toContain(label);
      }
    });
  });
});
