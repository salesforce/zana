import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./AgentViewToggle.tsx', import.meta.url), 'utf8');
const board = readFileSync(new URL('../views/agents/AgentsBoard.tsx', import.meta.url), 'utf8');

describe('ScheduledColumnToggle', () => {
  it('lives in the Agents toolbar next to the view switch', () => {
    expect(board).toContain('<ScheduledColumnToggle />');
    expect(board.indexOf('<AgentViewToggle />')).toBeLessThan(board.indexOf('<ScheduledColumnToggle />'));
  });

  it('toggles the persisted include-scheduled flag as a pressed Calendar control', () => {
    expect(source).toContain('export function ScheduledColumnToggle');
    expect(source).toContain('includeScheduledAgentsInAgentView');
    expect(source).toContain('setIncludeScheduledAgentsInAgentView');
    expect(source).toContain('void setIncludeScheduled(!includeScheduled)');
    expect(source).toContain('data-testid="agents-board-scheduled-toggle"');
    expect(source).toContain('aria-pressed={includeScheduled}');
    expect(source).toContain("includeScheduled ? 'Hide Scheduled column' : 'Show Scheduled column'");
    expect(source).toContain("includeScheduled ? 'active' : ''");
    expect(source).toContain('<Calendar size={14} />');
  });
});
