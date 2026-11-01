// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { ThreadListItem } from '../thread-store.js';

const h = vi.hoisted(() => ({ hosts: [] as Host[], compact: false }));
vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => h.hosts }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => h.compact }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: {} } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes } from './AgentBoard.js';
import { agentFleetItem, threadFleetItem } from './fleet-item.js';
import { primaryMachineLabel } from '../lib/machine-projects.js';
import { useData } from '../store.js';

const scratch: Project = { id: 'default', name: 'Default Project', path: '/scratch', quickAgent: true, createdAt: 1, lastActiveAt: 1 };
const thread = (id: string, hostId: string): ThreadListItem => ({
  id, hostId, projectId: scratch.id, title: id, status: 'idle', providerId: 'codex',
  environmentId: null, cwd: null, branchName: null, isWorktree: false, createdAt: 1
});

beforeEach(() => {
  h.compact = false;
  h.hosts = [
    { id: 'local', name: 'Primary', isPrimary: true, status: 'connected' },
    { id: 'remote', name: 'Devbox', isPrimary: false, status: 'connected' }
  ] as Host[];
  useData.setState({ projects: [scratch], includeScheduledAgentsInAgentView: false });
});
afterEach(cleanup);

describe('Default Project machine identity on the board', () => {
  const cards = () => [threadFleetItem(thread('Local task', 'local'), scratch), threadFleetItem(thread('Remote task', 'remote'), scratch)];
  const board = () => <MemoryRouter><AgentBoardLanes cards={cards()} showProject onInspect={vi.fn()} /></MemoryRouter>;

  it('separates local and remote defaults and shows the remote machine on its card', () => {
    render(board());
    const groups = document.querySelectorAll('.agents-lane-group');
    expect(groups).toHaveLength(2);
    const remote = screen.getByText('Default Project · Devbox').closest('.agents-lane-group')! as HTMLElement;
    expect(within(remote).getByText('Remote task')).toBeTruthy();
    expect(within(remote).queryByText('Local task')).toBeNull();
    expect(within(remote).getByText('Codex · Remote · Devbox')).toBeTruthy();
    expect(screen.getByText(`Default Project · ${primaryMachineLabel()}`)).toBeTruthy();
  });

  it('keeps host groups through disconnect, rename and removal', () => {
    const view = render(board());
    h.hosts = [h.hosts[0], { ...h.hosts[1], status: 'disconnected', name: 'Renamed box' }];
    view.rerender(board());
    expect(screen.getByText('Default Project · Renamed box')).toBeTruthy();
    expect(screen.getByText('Codex · Remote · Renamed box')).toBeTruthy();
    h.hosts = [h.hosts[0]];
    view.rerender(board());
    expect(screen.getByText('Default Project · Unavailable machine')).toBeTruthy();
    expect(screen.getByText('Codex · Remote · Unavailable machine')).toBeTruthy();
    expect(document.querySelectorAll('.agents-lane-group')).toHaveLength(2);
  });

  it('shows the execution machine in compact layouts too', () => {
    h.compact = true;
    render(board());
    expect(screen.getByText('Default Project · Devbox')).toBeTruthy();
    expect(screen.getByText('Codex · Remote · Devbox')).toBeTruthy();
  });

  it('puts CLI agents and threads from the same remote default in one group', () => {
    const cli = agentFleetItem({ projectId: scratch.id, projectName: scratch.name, state: 'idle', session: {
      id: 'cli', title: 'CLI task', hostId: 'remote', profile: 'codex', status: 'running', createdAt: 1
    } as TerminalSession });
    render(<MemoryRouter><AgentBoardLanes cards={[...cards(), cli]} showProject onInspect={vi.fn()} /></MemoryRouter>);
    const remote = screen.getByText('Default Project · Devbox').closest('.agents-lane-group')! as HTMLElement;
    expect(within(remote).getByText('CLI task')).toBeTruthy();
    expect(within(remote).getAllByText('Codex · Remote · Devbox')).toHaveLength(2);
    expect(remote.querySelector('.agents-lane-group-count')?.textContent).toBe('2');
  });

  it('keeps a projected Modern member on its recorded thread machine', () => {
    const member = agentFleetItem({ projectId: scratch.id, projectName: scratch.name, state: 'idle',
      modernThread: thread('Modern member', 'remote'),
      session: { id: 'member', title: 'Modern member', profile: 'codex', status: 'running', createdAt: 1 } as TerminalSession
    });
    render(<MemoryRouter><AgentBoardLanes cards={[member]} showProject onInspect={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Default Project · Devbox')).toBeTruthy();
    expect(screen.getByText('Codex · Remote · Devbox')).toBeTruthy();
  });
});
