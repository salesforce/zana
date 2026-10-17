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
    expect(brainstorm).toContain('Never use `execution.start`, `launch_team` or `zana_start_team`');
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
});
