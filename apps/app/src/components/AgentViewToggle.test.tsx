import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { scheduledColumnToggleLabel } from './AgentViewToggle.js';

const source = readFileSync(new URL('./AgentViewToggle.tsx', import.meta.url), 'utf8');
const board = readFileSync(new URL('../views/agents/AgentsBoard.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

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
    expect(source).toContain('scheduledColumnToggleLabel(includeScheduled, runningSchedules)');
    expect(source).toContain("includeScheduled ? 'active' : ''");
    expect(source).toContain('<Calendar size={14} />');
  });

  it('badges the Calendar control with the live running-scheduler count', () => {
    expect(source).toContain('useRunningSchedulerCount');
    expect(source).toContain('runningSchedules > 0');
    expect(source).toContain('agents-scheduled-toggle-badge');
    expect(source).toContain('nav-badge nav-badge--running');
    expect(css).toContain('.agents-scheduled-toggle-badge {');
  });
});

describe('scheduledColumnToggleLabel', () => {
  it('names the show/hide action when nothing is running', () => {
    expect(scheduledColumnToggleLabel(false, 0)).toBe('Show scheduled agents');
    expect(scheduledColumnToggleLabel(true, 0)).toBe('Hide scheduled agents');
  });

  it('prefixes the live running count so a hidden working job is still obvious', () => {
    expect(scheduledColumnToggleLabel(false, 3)).toBe('3 running · Show scheduled agents');
    expect(scheduledColumnToggleLabel(true, 1)).toBe('1 running · Hide scheduled agents');
  });
});
