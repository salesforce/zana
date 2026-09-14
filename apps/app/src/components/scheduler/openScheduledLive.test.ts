import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  threads: [] as Array<{ id: string }>,
  revealSchedule: vi.fn(),
  openAgentModal: vi.fn(),
  openThreadModal: vi.fn()
}));

vi.mock('../../thread-store.js', () => ({
  useThreads: {
    getState: () => ({ threads: h.threads })
  }
}));

vi.mock('../../store.js', () => ({
  useUi: {
    getState: () => ({
      revealSchedule: h.revealSchedule,
      openAgentModal: h.openAgentModal,
      openThreadModal: h.openThreadModal
    })
  }
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
    h.openAgentModal.mockReset();
    h.openThreadModal.mockReset();
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
    h.openAgentModal.mockReset();
    h.openThreadModal.mockReset();
  });

  it('peeks the agent modal when a pty session is still running', () => {
    const task = {
      id: 'job-1',
      projectId: 'proj-1',
      status: { runs: [{ at: '2026-01-01T00:00:00Z', result: 'success', sessionId: 'sess-1' }] }
    } as ScheduledTask;
    openScheduleFromAgents(task, { 'proj-1': [{ id: 'sess-1', status: 'running' } as never] });
    expect(h.openAgentModal).toHaveBeenCalledWith('sess-1', 'proj-1');
    expect(h.openThreadModal).not.toHaveBeenCalled();
    expect(h.revealSchedule).not.toHaveBeenCalled();
  });

  it('peeks the thread modal when the live id is a conversation thread', () => {
    h.threads = [{ id: 'thr-1' }];
    const task = {
      id: 'job-1',
      projectId: 'proj-1',
      status: { runs: [{ at: '2026-01-01T00:00:00Z', result: 'success', sessionId: 'thr-1' }] }
    } as ScheduledTask;
    openScheduleFromAgents(task, { 'proj-1': [{ id: 'thr-1', status: 'running' } as never] });
    expect(h.openThreadModal).toHaveBeenCalledWith('thr-1');
    expect(h.openAgentModal).not.toHaveBeenCalled();
    expect(h.revealSchedule).not.toHaveBeenCalled();
  });

  it('opens the editor when nothing is running', () => {
    const task = {
      id: 'job-1',
      projectId: 'proj-1',
      status: { runs: [] }
    } as ScheduledTask;
    openScheduleFromAgents(task, {});
    expect(h.revealSchedule).toHaveBeenCalledWith('job-1');
    expect(h.openAgentModal).not.toHaveBeenCalled();
    expect(h.openThreadModal).not.toHaveBeenCalled();
  });
});

describe('Running now / live-row wiring', () => {
  it('navigates to the live page from Scheduler instead of peeking a modal', () => {
    expect(helper).toContain('getAgentSessionRoutePath(sessionId, projectId)');
    expect(helper).toContain('getThreadRoutePath(sessionId, projectId)');
    expect(helper).toContain('openAgentModal(sessionId, task.projectId)');
    expect(helper).toContain('openThreadModal(sessionId)');
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
