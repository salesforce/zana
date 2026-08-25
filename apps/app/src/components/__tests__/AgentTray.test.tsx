import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  data: {
    terminals: {
      'project-1': [
        {
          id: 'agent-1',
          title: 'Review the sidebar',
          scheduled: false,
          headless: false
        }
      ]
    },
    projects: [{ id: 'project-1', name: 'Command Center', color: '#7765d9' }]
  },
  ui: {
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    openAgentModal: vi.fn()
  },
  status: { byId: { 'agent-1': 'working' } },
  threads: [] as Array<{
    id: string;
    projectId: string;
    status: string;
    title: string;
    archivedAt?: number | null;
  }>
}));

vi.mock('../../store', () => ({
  useData: Object.assign((selector: (state: typeof h.data) => unknown) => selector(h.data), {
    getState: () => h.data
  }),
  useUi: Object.assign((selector: (state: typeof h.ui) => unknown) => selector(h.ui), {
    getState: () => h.ui
  }),
  useAgentStatus: (selector: (state: typeof h.status) => unknown) => selector(h.status),
  useIdleTriage: Object.assign((selector: (state: { byId: Record<string, never> }) => unknown) => selector({ byId: {} }), {
    getState: () => ({ byId: {} })
  })
}));
vi.mock('../../thread-store', () => ({
  useThreads: (selector: (state: { threads: typeof h.threads }) => unknown) => selector({ threads: h.threads })
}));
vi.mock('../../hooks/useEnsureThreads', () => ({ useEnsureThreads: () => undefined }));
vi.mock('../FavoriteStar', () => ({ FavoriteStar: () => null }));
vi.mock('../agentCardActions', () => ({
  useAgentCardActions: () => ({
    menu: null,
    setMenu: vi.fn(),
    actions: {},
    rename: null,
    closeRename: vi.fn(),
    submitRename: vi.fn()
  }),
  AgentCardMenu: () => null,
  clampMenuAnchor: vi.fn()
}));
vi.mock('../PromptModal', () => ({ PromptModal: () => null }));

import { AgentTray } from '../AgentTray.js';

describe('AgentTray', () => {
  it('keeps a working agent visible beneath the Agents destination', () => {
    h.threads = [];
    const markup = renderToStaticMarkup(<MemoryRouter><AgentTray placement="inline" /></MemoryRouter>);

    expect(markup).toContain('class="agent-tray agent-tray--inline"');
    expect(markup).toContain('Review the sidebar');
    expect(markup).toContain('Command Center');
  });

  it('keeps an inline empty state visible when no agents or threads are active', () => {
    h.data.terminals = {} as typeof h.data.terminals;
    h.status.byId = {} as typeof h.status.byId;
    h.threads = [];

    const markup = renderToStaticMarkup(<MemoryRouter><AgentTray placement="inline" /></MemoryRouter>);

    expect(markup).toContain('class="agent-tray-empty"');
    expect(markup).toContain('No active agents or threads');
  });

  it('shows a project-scoped idle thread in the workspace tray but not the global tray', () => {
    h.data.terminals = {} as typeof h.data.terminals;
    h.status.byId = {} as typeof h.status.byId;
    h.threads = [
      {
        id: 'thread-1',
        projectId: 'project-1',
        providerId: 'claude-code',
        status: 'idle',
        title: 'Idle review'
      }
    ];

    const workspace = renderToStaticMarkup(
      <MemoryRouter>
        <AgentTray placement="inline" projectId="project-1" />
      </MemoryRouter>
    );
    expect(workspace).toContain('Idle review');
    expect(workspace).toContain('data-kind="thread"');

    const global = renderToStaticMarkup(
      <MemoryRouter>
        <AgentTray placement="inline" />
      </MemoryRouter>
    );
    expect(global).not.toContain('Idle review');
    expect(global).toContain('No active agents or threads');
  });
});
