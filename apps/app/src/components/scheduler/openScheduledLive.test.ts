import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  threads: [] as Array<{ id: string }>,
  revealSchedule: vi.fn(),
  inspectAgentSession: vi.fn(),
  inspectThread: vi.fn()
}));

vi.mock('../../thread-store.js', () => ({
  useThreads: {
    getState: () => ({ threads: h.threads })
  }
}));

vi.mock('../../store.js', () => ({
  useUi: {
    getState: () => ({
      revealSchedule: h.revealSchedule
    })
  }
}));

vi.mock('../../lib/inspect-session.js', () => ({
  inspectAgentSession: (...args: unknown[]) => h.inspectAgentSession(...args),
  inspectThread: (...args: unknown[]) => h.inspectThread(...args)
}));

import {
  openScheduledLive,
  openScheduleFromAgents,
  scheduledLivePath
} from './openScheduledLive.js';

const helper = readFileSync(new URL('./openScheduledLive.ts', import.meta.url), 'utf8');
const overview = readFileSync(new URL('./SchedulerOverview.tsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('./ScheduleRow.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('../../views/scheduler/SchedulerView.tsx', import.meta.url), 'utf8');

describe('openScheduledLive', () => {
  beforeEach(() => {
    h.threads = [];
    h.revealSchedule.mockReset();
    h.inspectAgentSession.mockReset();
    h.inspectThread.mockReset();
  });

  it('navigates to the thread page when the live id is a conversation thread', () => {
    h.threads = [{ id: 'thr-1' }];
    const navigate = vi.fn();
    openScheduledLive('proj-1', 'thr-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/projects/proj-1/threads/thr-1');
    expect(scheduledLivePath('proj-1', 'thr-1')).toBe('/projects/proj-1/threads/thr-1');
  });

  it('navigates to the agent session page for a pty session', () => {
    const navigate = vi.fn();
    openScheduledLive('proj-1', 'sess-1', navigate);
    expect(navigate).toHaveBeenCalledWith('/projects/proj-1/sessions/sess-1');
    expect(scheduledLivePath('proj-1', 'sess-1')).toBe('/projects/proj-1/sessions/sess-1');
  });
});

describe('openScheduleFromAgents', () => {
  beforeEach(() => {
    h.threads = [];
    h.revealSchedule.mockReset();
    h.inspectAgentSession.mockReset();
    h.inspectThread.mockReset();
  });

  it('inspects a running pty session', () => {
    const navigate = vi.fn();
    const task = {
      id: 'job-1',
      projectId: 'proj-1',
      status: { runs: [{ at: '2026-01-01T00:00:00Z', result: 'success', sessionId: 'sess-1' }] }
    } as ScheduledTask;
    openScheduleFromAgents(task, { 'proj-1': [{ id: 'sess-1', status: 'running' } as never] }, navigate);
    expect(h.inspectAgentSession).toHaveBeenCalledWith('sess-1', 'proj-1', navigate);
    expect(h.inspectThread).not.toHaveBeenCalled();
    expect(h.revealSchedule).not.toHaveBeenCalled();
  });

  it('inspects a conversation thread when the live id is a thread', () => {
    h.threads = [{ id: 'thr-1' }];
    const navigate = vi.fn();
    const task = {
      id: 'job-1',
      projectId: 'proj-1',
      status: { runs: [{ at: '2026-01-01T00:00:00Z', result: 'success', sessionId: 'thr-1' }] }
    } as ScheduledTask;
    openScheduleFromAgents(task, { 'proj-1': [{ id: 'thr-1', status: 'running' } as never] }, navigate);
    expect(h.inspectThread).toHaveBeenCalledWith('thr-1', 'proj-1', navigate);
    expect(h.inspectAgentSession).not.toHaveBeenCalled();
    expect(h.revealSchedule).not.toHaveBeenCalled();
  });

  it('opens the editor when nothing is running', () => {
    const navigate = vi.fn();
    const task = {
      id: 'job-1',
      projectId: 'proj-1',
      status: { runs: [] }
    } as ScheduledTask;
    openScheduleFromAgents(task, {}, navigate);
    expect(h.revealSchedule).toHaveBeenCalledWith('job-1');
    expect(h.inspectAgentSession).not.toHaveBeenCalled();
    expect(h.inspectThread).not.toHaveBeenCalled();
  });
});

describe('Running now / live-row wiring', () => {
  it('navigates to the live page from Scheduler instead of peeking a modal', () => {
    expect(helper).toContain('getAgentSessionRoutePath(sessionId, projectId)');
    expect(helper).toContain('getThreadRoutePath(sessionId, projectId)');
    expect(helper).toContain('inspectAgentSession(sessionId, task.projectId, navigate)');
    expect(helper).toContain('inspectThread(sessionId, task.projectId, navigate)');
    expect(view).toContain('openScheduledLive(t.projectId, sessionId, navigate)');
    expect(view).not.toContain('openAgentModal');
    expect(view).not.toContain('openThreadModal');
    expect(view).not.toContain('restoreTerminal');
    expect(view).not.toContain("setProjectView(t.projectId, 'terminals')");
    expect(row).toContain('openScheduledLive(task.projectId, liveSessionId, navigate)');
    expect(overview).toContain('onOpenTerminal(task, sessionId)');
    expect(overview).toContain('title="Open the running session"');
  });
});
