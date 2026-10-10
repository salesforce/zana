import { describe, expect, it } from 'vitest';
import { runningProcessCount, runningProcessLabel, withRunningProcessWarning } from './thread-running-processes.js';

const activity = (activeBackgroundCommandCount: number) => ({
  activity: {
    activeWorkflowCount: 0,
    activeBackgroundAgentCount: 0,
    activeBackgroundCommandCount,
    activeGoalCount: 0,
    activePlanModeCount: 0
  }
});

describe('thread running processes', () => {
  it('counts running background commands, treating missing or negative as none', () => {
    expect(runningProcessCount(undefined)).toBe(0);
    expect(runningProcessCount(null)).toBe(0);
    expect(runningProcessCount({})).toBe(0);
    expect(runningProcessCount(activity(-1))).toBe(0);
    expect(runningProcessCount(activity(2))).toBe(2);
  });

  it('labels one and many processes', () => {
    expect(runningProcessLabel(1)).toBe('1 background process running');
    expect(runningProcessLabel(3)).toBe('3 background processes running');
  });

  it('leaves the message alone when nothing is running', () => {
    expect(withRunningProcessWarning('Archive “x”?', activity(0))).toBe('Archive “x”?');
    expect(withRunningProcessWarning('Archive “x”?', undefined)).toBe('Archive “x”?');
  });

  it('warns that ending the session stops the running processes', () => {
    expect(withRunningProcessWarning('Archive “x”?', activity(1))).toBe(
      'Archive “x”?\n\nThis agent still has a background process running, like a dev server. Ending its session stops it.'
    );
    expect(withRunningProcessWarning('Archive “x”?', activity(2))).toBe(
      'Archive “x”?\n\nThis agent still has 2 background processes running, like a dev server. Ending its session stops them.'
    );
  });
});
