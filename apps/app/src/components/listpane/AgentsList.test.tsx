import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';

const setAgentsBoardView = vi.fn();

vi.mock('@/store', () => ({
  useData: (selector: (state: object) => unknown) => selector({
    terminals: {}, projects: [], agentListNeedsYouFromTriage: false, idleAttentionSensitivity: 'medium'
  }),
  useUi: Object.assign(
    (selector: (state: object) => unknown) => selector({ selectedTabId: {}, selectedProjectId: null }),
    { getState: () => ({ setAgentsBoardView }) }
  ),
  useAgentStatus: (selector: (state: object) => unknown) => selector({ byId: {} }),
  useIdleTriage: (selector: (state: object) => unknown) => selector({ byId: {} }),
  openWhatsNewAll: vi.fn()
}));
vi.mock('@/thread-store', () => ({
  useThreads: (selector: (state: { threads: unknown[]; load: () => void }) => unknown) =>
    selector({ threads: [], load: () => undefined })
}));

vi.mock('@/hooks/useEnsureThreads', () => ({ useEnsureThreads: () => undefined }));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/lib/profileIcon', () => ({ profileIcon: () => null }));
vi.mock('@/lib/sessionBuckets', () => ({ isRecentlyFinished: () => false }));
vi.mock('@/components/AgentBoard', () => ({ idleSurfacesToNeedsYou: () => false, partitionSquadMembers: (rows: unknown[]) => ({ top: rows, workersByHost: new Map() }) }));
vi.mock('@/components/AgentLauncher', () => ({ AgentLauncher: () => null }));
vi.mock('@/components/agentCardActions', () => ({ useAgentCardActions: () => ({ menu: null, setMenu: vi.fn(), actions: {}, rename: null, closeRename: vi.fn(), submitRename: vi.fn() }), AgentCardMenu: () => null, clampMenuAnchor: vi.fn() }));
vi.mock('@/components/PromptModal', () => ({ PromptModal: () => null }));
vi.mock('@/components/ListPaneResizer', () => ({ ListPaneResizer: () => null }));

import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { AgentsListPane, openFullAgentsList, applyExecutionRefreshResults } from './AgentsList.js';

function fakeExecution(id: string, projectId: string): ExecutionBoardProjection {
  return {
    executionId: id,
    projectId,
    jobTitle: `Job ${id}`,
    state: 'RUNNING',
    attempt: 1,
    createdAt: 1,
    updatedAt: 1
  };
}

describe('AgentsListPane', () => {
  it('offers an accessible control to open the full-width Agents list', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AgentsListPane /></MemoryRouter>);

    expect(html).toContain('aria-label="Open full-width Agents list"');
    expect(html).toContain('aria-label="New agent"');
    expect(html).toContain('New agent');
    expect(html).not.toContain('Legacy PTY');
    expect(html).not.toContain('aria-expanded');
  });

  it('switches to the list monitor when the control is activated', () => {
    openFullAgentsList(setAgentsBoardView);

    expect(setAgentsBoardView).toHaveBeenCalledWith('list');
  });

  it('mixes threads into status groups instead of a dedicated Threads section', () => {
    const source = readFileSync(new URL('./AgentsList.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('data-testid="thread-list"');
    expect(source).toContain("entry.kind === 'thread'");
    expect(source).toContain('<FleetKindChip kind="agent" />');
    expect(source).toContain('openLauncher');
    expect(source).toContain('setLauncherOpen(true)');
    expect(source).not.toContain('getNewThreadRoutePath');
    expect(source).not.toContain('getRootRoutePath');
    expect(source).not.toContain('agents-legacy-new');
    expect(source).toContain('aria-label="New agent"');
    expect(source).toContain('threadIdFromPath');
    expect(source).toContain('sessionIdFromPath');
    expect(source).toContain('getAgentSessionRoutePath');
    expect(source).not.toContain('openAgentModal');
    expect(source).toContain('usePaneContentSplitDrag');
    expect(source).toContain('onLaunched');
    expect(source).toContain('getAgentSessionRoutePath(session.id, scopedProjectId)');
    expect(source).toContain('getAgentSessionRoutePath(t.id, scopedProjectId)');
    expect(source).toContain('agents-row-needs-you');
  });
});

describe('applyExecutionRefreshResults', () => {
  it('applies all fulfilled projects when every call succeeds', () => {
    const prior = new Map<string, ExecutionBoardProjection[]>();
    const onError = vi.fn();
    const merged = applyExecutionRefreshResults(
      ['p1', 'p2'],
      [
        { status: 'fulfilled', value: { executions: [fakeExecution('e1', 'p1')] } },
        { status: 'fulfilled', value: { executions: [fakeExecution('e2', 'p2')] } }
      ],
      prior,
      onError
    );

    expect(merged.map((e) => e.executionId)).toEqual(['e1', 'e2']);
    expect(onError).not.toHaveBeenCalled();
  });

  it('retains a rejected project\'s prior executions instead of blanking them, and still applies the sibling\'s fresh result', () => {
    const prior = new Map<string, ExecutionBoardProjection[]>([
      ['p1', [fakeExecution('e1-old', 'p1')]]
    ]);
    const onError = vi.fn();
    const merged = applyExecutionRefreshResults(
      ['p1', 'p2'],
      [
        { status: 'rejected', reason: new Error('p1 boom') },
        { status: 'fulfilled', value: { executions: [fakeExecution('e2', 'p2')] } }
      ],
      prior,
      onError
    );

    // p1's stale-but-retained data survives; p2's fresh result is applied.
    expect(merged.map((e) => e.executionId)).toEqual(['e1-old', 'e2']);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('p1', expect.any(Error));
  });

  it('does not throw and yields no entries for a project that has never succeeded', () => {
    const prior = new Map<string, ExecutionBoardProjection[]>();
    const onError = vi.fn();
    const merged = applyExecutionRefreshResults(
      ['p1'],
      [{ status: 'rejected', reason: 'network down' }],
      prior,
      onError
    );

    expect(merged).toEqual([]);
    expect(onError).toHaveBeenCalledWith('p1', 'network down');
  });

  it('a rejection for every project leaves the merged list empty without an unhandled rejection', () => {
    const prior = new Map<string, ExecutionBoardProjection[]>();
    const onError = vi.fn();
    const merged = applyExecutionRefreshResults(
      ['p1', 'p2'],
      [
        { status: 'rejected', reason: 'a' },
        { status: 'rejected', reason: 'b' }
      ],
      prior,
      onError
    );

    expect(merged).toEqual([]);
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
