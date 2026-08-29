import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({
  threads: [] as Array<{ id: string }>,
  openThreadModal: vi.fn(),
  openAgentModal: vi.fn()
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

import { openScheduledLive } from './openScheduledLive.js';

const helper = readFileSync(new URL('./openScheduledLive.ts', import.meta.url), 'utf8');
const overview = readFileSync(new URL('./SchedulerOverview.tsx', import.meta.url), 'utf8');
const row = readFileSync(new URL('./ScheduleRow.tsx', import.meta.url), 'utf8');
const view = readFileSync(new URL('../../views/scheduler/SchedulerView.tsx', import.meta.url), 'utf8');

describe('openScheduledLive', () => {
  beforeEach(() => {
    h.threads = [];
    h.openThreadModal.mockReset();
    h.openAgentModal.mockReset();
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
