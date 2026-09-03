import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({
  threads: [] as Array<{ id: string }>,
  openThreadModal: vi.fn(),
  openAgentModal: vi.fn(),
  openThreadInSplit: vi.fn(),
  openAgentSessionInSplit: vi.fn(),
  isCompact: false
}));

vi.mock('../../store.js', () => ({
  useUi: {
    getState: () => ({
      openThreadModal: h.openThreadModal,
      openAgentModal: h.openAgentModal
    })
  }
}));

vi.mock('../../thread-store.js', () => ({
  useThreads: {
    getState: () => ({ threads: h.threads })
  }
}));

vi.mock('../../hooks/useIsCompactViewport.js', () => ({
  isCompactViewport: () => h.isCompact
}));

vi.mock('../../lib/split-layout/openThreadInSplit.js', () => ({
  openThreadInSplit: (...args: unknown[]) => h.openThreadInSplit(...args),
  openAgentSessionInSplit: (...args: unknown[]) => h.openAgentSessionInSplit(...args)
}));

import { openScheduledLive, openScheduledLiveInSplit } from './openScheduledLive.js';

const helper = readFileSync(new URL('./openScheduledLive.ts', import.meta.url), 'utf8');
const overview = readFileSync(new URL('./SchedulerOverview.tsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('./ScheduleRow.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('../../views/scheduler/SchedulerView.tsx', import.meta.url), 'utf8');

describe('openScheduledLive', () => {
  beforeEach(() => {
    h.threads = [];
    h.isCompact = false;
    h.openThreadModal.mockReset();
    h.openAgentModal.mockReset();
    h.openThreadInSplit.mockReset();
    h.openAgentSessionInSplit.mockReset();
  });

  it('opens the thread modal when the live id is a conversation thread', () => {
    h.threads = [{ id: 'thr-1' }];
    openScheduledLive('proj-1', 'thr-1');
    expect(h.openThreadModal).toHaveBeenCalledWith('thr-1');
    expect(h.openAgentModal).not.toHaveBeenCalled();
  });

  it('opens the agent inspector modal for a pty session', () => {
    openScheduledLive('proj-1', 'sess-1');
    expect(h.openAgentModal).toHaveBeenCalledWith('sess-1', 'proj-1');
    expect(h.openThreadModal).not.toHaveBeenCalled();
  });
});

describe('Running now / live-row wiring', () => {
  it('peeks via the inspector overlay instead of promoting a terminal tab', () => {
    expect(helper).toContain('openThreadModal(sessionId)');
    expect(helper).toContain('openAgentModal(sessionId, projectId)');
    expect(view).toContain('openScheduledLive(t.projectId, sessionId)');
    expect(view).not.toContain('restoreTerminal');
    expect(view).not.toContain("setWorkspaceMode(t.projectId, 'terminals')");
    expect(row).toContain('openScheduledLive(task.projectId, liveSessionId)');
    expect(overview).toContain('onOpenTerminal(task, sessionId)');
    expect(overview).toContain('title="Peek the running session"');
  });
});

describe('openScheduledLiveInSplit', () => {
  beforeEach(() => {
    h.threads = [];
    h.isCompact = false;
    h.openThreadInSplit.mockReset();
    h.openAgentSessionInSplit.mockReset();
  });

  it('opens a conversation thread in split', () => {
    h.threads = [{ id: 'thr-1' }];
    const navigate = vi.fn();
    openScheduledLiveInSplit('proj-1', 'thr-1', navigate, '/schedules/s1');
    expect(h.openThreadInSplit).toHaveBeenCalledWith({
      navigate,
      projectId: 'proj-1',
      threadId: 'thr-1',
      isCompact: false,
      currentPathname: '/schedules/s1'
    });
    expect(h.openAgentSessionInSplit).not.toHaveBeenCalled();
  });

  it('opens a pty session in split', () => {
    const navigate = vi.fn();
    openScheduledLiveInSplit('proj-1', 'sess-1', navigate, '/schedules/s1');
    expect(h.openAgentSessionInSplit).toHaveBeenCalledWith({
      navigate,
      projectId: 'proj-1',
      sessionId: 'sess-1',
      isCompact: false,
      currentPathname: '/schedules/s1'
    });
  });
});
