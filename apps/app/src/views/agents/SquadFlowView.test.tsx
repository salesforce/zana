import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./SquadFlowView.tsx', import.meta.url), 'utf8');

describe('SquadFlowView execution-board poll refresh', () => {
  it('uses allSettled so one project rejecting cannot blank out every project', () => {
    expect(view).toContain('Promise.allSettled(targets.map((id) => window.cc.executionBoard.listProject(id)))');
    expect(view).not.toContain('Promise.all(targets.map((id) => window.cc.executionBoard.listProject(id)))');
  });

  it('logs a rejected project poll instead of throwing unhandled', () => {
    expect(view).toContain(
      "console.error(\n                `[SquadFlowView] executionBoard.listProject failed for project ${pid}`,\n                result.reason\n              );"
    );
  });

  it('falls back to the project\'s own previously-fetched executions on rejection, not an empty list', () => {
    expect(view).toContain('return prev.filter((execution) => execution.projectId === pid);');
  });

  it('applies fulfilled results directly rather than gating the whole tick on every project succeeding', () => {
    expect(view).toContain('if (result.status === \'fulfilled\') return result.value.executions;');
  });
});
