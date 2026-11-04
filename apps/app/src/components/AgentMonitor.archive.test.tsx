// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentCard } from './AgentBoard.js';

vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('./AgentSessionView.js', () => ({
  AgentSessionView: ({ footer }: { footer: ReactNode }) => <div data-testid="footer">{footer}</div>
}));
vi.mock('../lib/product-client.js', () => ({ product: { config: { set: vi.fn().mockResolvedValue({}) } } }));

import { AgentMonitor } from './AgentMonitor.js';
import { agentFleetItem } from './fleet-item.js';
import { useData, useUi } from '../store.js';

const ARCHIVE_TITLE = 'Stop the agent and remove it from the board. Its conversation stays in History.';
const NEUTRAL_TITLE = 'Stop the agent and remove it from the board.';
const localProject = { id: 'p', name: 'Project', path: '/tmp' } as never;
const remoteProject = { id: 'p', name: 'Project', path: '/tmp', remote: { host: 'h' } } as never;

function mount(session: { profile: string; status: string }) {
  const card = agentFleetItem({
    projectId: 'p', projectName: 'Project', state: 'idle',
    session: { id: 'cli', projectId: 'p', title: 'Task', cwd: '/tmp', createdAt: 1, ...session }
  } as AgentCard);
  useUi.setState({ agentMonitor: { sessionId: 'cli', projectId: 'p' } });
  render(<MemoryRouter><AgentMonitor cards={[card]} /></MemoryRouter>);
  return screen.getByTestId('footer').querySelector('button.danger') as HTMLButtonElement;
}

beforeEach(() => {
  useData.setState({ projects: [localProject], terminals: {}, agentsListOrganization: 'status', includeScheduledAgentsInAgentView: false });
});
afterEach(cleanup);

describe('AgentMonitor footer remove button', () => {
  it('archives a live agent with the History tooltip and the Archive icon', () => {
    const button = mount({ profile: 'claude', status: 'running' });
    expect(button.textContent).toContain('Archive');
    expect(button.title).toBe(ARCHIVE_TITLE);
    expect(button.innerHTML).toContain('lucide-archive');
  });

  it('uses neutral wording for a harness without History, and for a remote project', () => {
    expect(mount({ profile: 'mastracode', status: 'running' }).title).toBe(NEUTRAL_TITLE);
    cleanup();
    useData.setState({ projects: [remoteProject] });
    expect(mount({ profile: 'claude', status: 'running' }).title).toBe(NEUTRAL_TITLE);
  });

  it('keeps Delete and the bin for a live plain shell', () => {
    const button = mount({ profile: 'shell', status: 'running' });
    expect(button.textContent).toContain('Delete');
    expect(button.title).toBe('Terminate this agent and remove it from the board');
    expect(button.innerHTML).toContain('lucide-trash');
  });

  it('keeps Dismiss for an exited session', () => {
    const button = mount({ profile: 'claude', status: 'exited' });
    expect(button.textContent).toContain('Dismiss');
    expect(button.title).toBe('Dismiss this finished agent from the board');
    expect(button.innerHTML).toContain('lucide-trash');
  });
});
