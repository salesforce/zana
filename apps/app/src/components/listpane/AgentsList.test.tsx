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

import { AgentsListPane, openFullAgentsList } from './AgentsList.js';

describe('AgentsListPane', () => {
  it('offers an accessible control to open the full-width Agents list', () => {
    const html = renderToStaticMarkup(<MemoryRouter><AgentsListPane /></MemoryRouter>);

    expect(html).toContain('aria-label="Open full-width Agents list"');
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
    expect(source).toContain('getNewThreadRoutePath');
    expect(source).not.toContain('getRootRoutePath');
    expect(source).toContain('NEW_THREAD_ROUTE_PATH');
    expect(source).toContain('PROJECT_NEW_THREAD_ROUTE_PATH');
  });
});
