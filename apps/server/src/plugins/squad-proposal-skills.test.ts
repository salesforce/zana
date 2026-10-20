import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`./builtin-skills/${name}/SKILL.md`, import.meta.url), 'utf8');
const brainstorm = read('brainstorm');
const inbox = read('zcc-inbox');

describe('squad proposal skills', () => {
  it('brainstorm teaches the propose flow and keeps its existing sections', () => {
    expect(brainstorm).toContain('## When the user wants it built');
    for (const name of ['mcp__zcc-inbox__squad_plan_check', 'mcp__zcc-inbox__squad_propose', 'zcc_squad_plan_check', 'zcc_squad_propose', 'zcc_list_teams']) {
      expect(brainstorm).toContain(name);
    }
    expect(brainstorm).toContain('project library');
    expect(brainstorm).toContain('[Squad report]');
    expect(brainstorm).toContain('On the review-first path, never use `execution.start`, `launch_team` or\n`zana_start_team`');
    expect(brainstorm).not.toContain('Never use `execution.start`, `launch_team` or `zana_start_team` for this.');
    expect(brainstorm).toContain('## Running the session');
    expect(brainstorm).toContain('## Where ideas are stored');
  });

  it('zcc-inbox documents both tools, the owner rule and the last-slot recipe', () => {
    for (const name of ['mcp__zcc-inbox__squad_plan_check', 'mcp__zcc-inbox__squad_propose', 'zcc_squad_plan_check', 'zcc_squad_propose']) {
      expect(inbox).toContain(name);
    }
    expect(inbox).toContain('### Hand a design to a Squad');
    expect(inbox).toContain('`execution.start` is for agent-owned orchestration');
    expect(inbox).toContain('one `initialTask` per expanded slot: each worker slot\n   in order, then the orchestrator last.');
    expect(inbox).toContain('The orchestrator is the LAST slot of the\n   task list, so the brief goes on the last slot.');
    expect(inbox).not.toContain('per requested worker slot');
    expect(inbox).toContain('[Squad report]');
  });

  describe('prompt routing between review first and start now', () => {
    /** The routing table: from its header row through its last row. */
    const routingTable = (text: string) => {
      const lines = text.split('\n');
      const start = lines.findIndex((line) => line.startsWith('| User says (examples) |'));
      expect(start).toBeGreaterThanOrEqual(0);
      const end = lines.findIndex((line, index) => index > start && !line.startsWith('|'));
      return lines.slice(start, end).join('\n');
    };
    const START_NOW_RULE = 'Start now only when the user\'s message explicitly asks to start immediately. Do not\ninfer it from urgency or from "go ahead".';

    it('teaches the identical table in both skills', () => {
      const table = routingTable(brainstorm);
      expect(routingTable(inbox)).toBe(table);
      expect(table).toContain('| Review first | `squad_plan_check` → `list_teams` → `squad_propose`');
      expect(table).toContain('| Start now | `execution.start`');
      expect(table).toContain('| Anything else, or unclear | Review first |');
    });

    it('states the start-now rule and the one-line path notice in both', () => {
      for (const skill of [brainstorm, inbox]) {
        expect(skill).toContain(START_NOW_RULE);
        expect(skill).toContain('Say which path you took, in one line');
      }
    });

    it('scopes the execution.start ban to the review-first path', () => {
      expect(inbox).toContain('Review first: save the files to the project library, run `squad_plan_check`, pick\na Squad with `list_teams`, then call `squad_propose`; do not call `execution.start`.');
      expect(inbox).toContain('Use it to build a design only when the user explicitly asks to start now');
    });
  });
});
