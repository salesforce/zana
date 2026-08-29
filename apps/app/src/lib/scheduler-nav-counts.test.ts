import { describe, expect, it } from 'vitest';
import type { ScheduleRun, ScheduleStatus, TerminalSession } from '@zana-ai/zcc-domain/product';
import { runningSchedulerCount } from './scheduler-nav-counts.js';

function session(over: Partial<TerminalSession> & Pick<TerminalSession, 'id'>): TerminalSession {
  return {
    title: over.id,
    status: 'running',
    profile: 'claude',
    createdAt: 1,
    ...over
  } as TerminalSession;
}

function status(runs: ScheduleRun[]): ScheduleStatus {
  return { runCount: runs.length, runs };
}

describe('runningSchedulerCount', () => {
  it('counts a schedule whose latest live session is still running', () => {
    expect(runningSchedulerCount(
      [{ projectId: 'p1', status: status([{ at: '1', result: 'success', sessionId: 'a' }]) }],
      { p1: [session({ id: 'a' })] }
    )).toBe(1);
  });

  it('does not count an armed schedule whose session has already exited', () => {
    expect(runningSchedulerCount(
      [{ projectId: 'p1', status: status([{ at: '1', result: 'success', sessionId: 'a' }]) }],
      { p1: [session({ id: 'a', status: 'exited' })] }
    )).toBe(0);
  });

  it('still counts when the live session is filed under a different project key', () => {
    expect(runningSchedulerCount(
      [{ projectId: 'p1', status: status([{ at: '1', result: 'success', sessionId: 'a' }]) }],
      { other: [session({ id: 'a' })] }
    )).toBe(1);
  });

  it('counts each schedule at most once even with multiple live runs', () => {
    expect(runningSchedulerCount(
      [{
        projectId: 'p1',
        status: status([
          { at: '2', result: 'success', sessionId: 'b' },
          { at: '1', result: 'success', sessionId: 'a' }
        ])
      }],
      { p1: [session({ id: 'a' }), session({ id: 'b' })] }
    )).toBe(1);
  });
});
