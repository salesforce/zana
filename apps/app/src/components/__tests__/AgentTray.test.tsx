import { renderToStaticMarkup } from 'react-dom/server';
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
  status: { byId: { 'agent-1': 'working' } }
}));

vi.mock('../../store', () => ({
  useData: (selector: (state: typeof h.data) => unknown) => selector(h.data),
  useUi: Object.assign((selector: (state: typeof h.ui) => unknown) => selector(h.ui), {
    getState: () => h.ui
  }),
  useAgentStatus: (selector: (state: typeof h.status) => unknown) => selector(h.status)
}));
vi.mock('../FavoriteStar', () => ({ FavoriteStar: () => null }));

import { AgentTray } from '../AgentTray.js';

describe('AgentTray', () => {
  it('keeps a working agent visible beneath the Agents destination', () => {
    const markup = renderToStaticMarkup(<AgentTray placement="inline" />);

    expect(markup).toContain('class="agent-tray agent-tray--inline"');
    expect(markup).toContain('Review the sidebar');
    expect(markup).toContain('Command Center');
  });

  it('keeps an inline empty state visible when no agents are active', () => {
    h.data.terminals = {} as typeof h.data.terminals;
    h.status.byId = {} as typeof h.status.byId;

    const markup = renderToStaticMarkup(<AgentTray placement="inline" />);

    expect(markup).toContain('class="agent-tray-empty"');
    expect(markup).toContain('No active agents');
  });
});
