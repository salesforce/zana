import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(new URL(`./builtin-skills/${name}/SKILL.md`, import.meta.url), 'utf8');
const brainstorm = read('brainstorm');
const inbox = read('zcc-inbox');

describe('squad proposal skills', () => {
  it('brainstorm teaches the propose flow and keeps its existing sections', () => {
    expect(brainstorm).toContain('## When the user wants it built');
    for (const name of ['mcp__zcc-inbox__squad_plan_check', 'mcp__zcc-inbox__squad_launch', 'zcc_squad_plan_check', 'zcc_squad_launch', 'zcc_list_teams']) {
      expect(brainstorm).toContain(name);
    }
    expect(brainstorm).toContain('wherever they are: this project, your home folder (a doc vault, `~/.zcc/library`)');
    expect(brainstorm).toContain('`SOURCE_NOT_ALLOWED`');
    expect(brainstorm).not.toContain('cannot be attached');
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

  it('teaches squad_launch as the agent default and execution.start as low-level', () => {
    for (const name of ['mcp__zcc-inbox__squad_launch', 'zcc_squad_launch']) {
      expect(brainstorm).toContain(name);
      expect(inbox).toContain(name);
    }
    expect(brainstorm).toContain("Call `squad_launch` with `mode: 'review'`");
    expect(inbox).toContain("`squad_launch` with `mode: 'review'`; do not call `execution.start`");
    expect(inbox).toContain('It is the\nlow-level path (explicit slots, work units, policy) and is deprecated for agent\nuse');
    for (const code of ['LAUNCH_REVIEW_REQUIRED', 'LAUNCH_IN_PROGRESS', 'TOO_MANY_LAUNCHES']) {
      expect(inbox).toContain(code);
    }
    expect(brainstorm).toContain('LAUNCH_REVIEW_REQUIRED');
    expect(brainstorm).not.toContain('The start-now\npath is `execution.start`');
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
      expect(table).toContain("| Review first | `squad_plan_check` → `list_teams` → `squad_launch` with `mode: 'review'`");
      expect(table).toContain("| Start now | `squad_launch` with `mode: 'now'`");
      expect(table).toContain('| Anything else, or unclear | Review first |');
    });

    it('states the start-now rule and the one-line path notice in both', () => {
      for (const skill of [brainstorm, inbox]) {
        expect(skill).toContain(START_NOW_RULE);
        expect(skill).toContain('Say which path you took, in one line');
      }
    });

    it('teaches the owner of a started run to wait for reports, not poll, and how to answer', () => {
      expect(inbox).toContain('After Start you will receive a\n   `[Squad report]` when the run finishes or needs a human answer. Don\'t poll in\n   a loop');
      expect(inbox).toContain('`execution.respond { executionId, expectedStateVersion, blockerId, message }`');
      expect(inbox).toContain('Add `notify: true` so the run\n   reports back to you.');
      expect(inbox).toContain('| Answer a question it reported | `mcp__zcc-inbox__execution.respond` | `zcc_execution_respond` |');
      expect(inbox).not.toContain('advance `after` to the newest event cursor');
      expect(brainstorm).toContain('A Squad you started yourself (start now) is yours to answer');
    });

    it('scopes the execution.start ban to the review-first path', () => {
      expect(inbox).toContain('then call `squad_launch` with `mode: \'review\'`; do not call `execution.start`.');
      expect(inbox).toContain('by their exact paths (do not copy them)');
      expect(inbox).toContain("Use `mode: 'now'` to build a design only\nwhen the user explicitly asks to start now");
    });
  });
});
