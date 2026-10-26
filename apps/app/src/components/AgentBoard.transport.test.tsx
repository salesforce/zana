// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionBoardProjection, TerminalSession } from '@zana-ai/zcc-domain/product';

vi.mock('../hooks/useHosts.js', () => ({ useHosts: () => [] }));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../lib/product-client.js', () => ({ product: { terminals: {}, threads: { notificationLevel: () => Promise.reject(new Error('unavailable')) } } }));
vi.mock('../lib/gitInfo.js', () => ({ useSessionGit: () => null }));

import { AgentBoardLanes, type AgentCard } from './AgentBoard.js';
import { agentFleetItem, threadFleetItem } from './fleet-item.js';
import { useTeams } from '../store.js';
import { withModernSquadMembers } from '../lib/modern-squad-members.js';

const execution = (executionId: string, teamId: string, jobTitle: string) => ({
  executionId, projectId: 'p', teamId, jobTitle, state: 'RUNNING', attempt: 1, createdAt: 1, updatedAt: 2
}) as ExecutionBoardProjection;

const cardButton = (title: string) => screen.getByText(title).closest('button')!;
const chipKind = (button: Element) => button.querySelector('.fleet-kind-chip')?.getAttribute('data-kind');

describe('AgentBoard squad transport', () => {
  beforeEach(() => {
    useTeams.setState({
      teams: [
        { id: 'modern', name: 'Modern squad', slots: [], transport: 'MODERN' },
        { id: 'cli', name: 'CLI squad', slots: [] }
      ] as never,
      loading: false
    });
  });
  afterEach(cleanup);

  it('labels a Modern squad Job host Thread with the dotted modifier; a CLI squad Job stays CLI Agent', () => {
    render(
      <MemoryRouter>
        <AgentBoardLanes cards={[]} executions={[execution('e-m', 'modern', 'Modern job'), execution('e-c', 'cli', 'CLI job')]} onInspect={vi.fn()} />
      </MemoryRouter>
    );
    const modern = cardButton('Modern job');
    expect(chipKind(modern)).toBe('thread');
    expect(modern.classList.contains('is-modern')).toBe(true);
    expect(modern.getAttribute('data-squad-transport')).toBe('MODERN');
    const cli = cardButton('CLI job');
    expect(chipKind(cli)).toBe('agent');
    expect(cli.classList.contains('is-modern')).toBe(false);
    expect(cli.getAttribute('data-squad-transport')).toBe('CLI');
  });

  it('keeps a live squad session a CLI Agent and tags its nested workers CLI Agent too', () => {
    const session = (id: string, role: 'orchestrator' | 'worker', title: string) => ({
      id, title, status: 'running', profile: 'claude', createdAt: 1,
      cohort: { cohortId: 'c1', teamId: 'modern', teamName: 'Modern squad', role, slotLabel: title }
    }) as TerminalSession;
    const card = (s: TerminalSession): AgentCard => ({ session: s, projectId: 'p', projectName: 'P', state: 'working', liveSubagents: 0 });
    render(
      <MemoryRouter>
        <AgentBoardLanes
          cards={[agentFleetItem(card(session('o1', 'orchestrator', 'Lead'))), agentFleetItem(card(session('w1', 'worker', 'Helper')))]}
          onInspect={vi.fn()}
        />
      </MemoryRouter>
    );
    const lead = cardButton('Lead');
    expect(chipKind(lead)).toBe('agent');
    expect(lead.classList.contains('is-modern')).toBe(false);
    expect(chipKind(cardButton('Helper'))).toBe('agent');
  });

  it('marks a Modern squad member thread card dotted', () => {
    const thread = {
      id: 't1', projectId: 'p', hostId: 'h', environmentId: null, providerId: 'claude-code', status: 'idle',
      title: 'Modern lead', createdAt: 1, cwd: null, branchName: null, isWorktree: false, originPluginId: 'host-modern-squad'
    };
    render(<MemoryRouter><AgentBoardLanes cards={[threadFleetItem(thread)]} onInspect={vi.fn()} /></MemoryRouter>);
    const button = cardButton('Modern lead');
    expect(chipKind(button)).toBe('thread');
    expect(button.classList.contains('is-modern')).toBe(true);
  });

  it('groups Modern squad members like a CLI squad: live orchestrator hosts, workers nest', () => {
    const thread = (id: string, title: string) => ({
      id, projectId: 'p', hostId: 'h', environmentId: null, providerId: 'claude-code', status: 'idle',
      title, createdAt: 1, cwd: null, branchName: null, isWorktree: false
    });
    const job = {
      ...execution('e-m', 'modern', 'Modern job'),
      modernMembers: [
        { threadId: 't-lead', slotId: 'orchestrator', personaId: 'lead', role: 'orchestrator' as const, live: true },
        { threadId: 't-work', slotId: 'writer', personaId: 'writer', role: 'worker' as const, live: true }
      ]
    };
    const onInspect = vi.fn();
    render(
      <MemoryRouter>
        <AgentBoardLanes
          cards={withModernSquadMembers(
            [threadFleetItem(thread('t-lead', 'Lead thread')), threadFleetItem(thread('t-work', 'Writer thread')), threadFleetItem(thread('t-solo', 'Solo thread'))],
            [job]
          )}
          executions={[job]}
          onInspect={onInspect}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('Solo thread')).toBeTruthy();
    // The live Modern orchestrator is the Job host, exactly like a CLI coordinator.
    const host = cardButton('Modern job');
    expect(host.className).toContain('lane-working');
    expect(host.className).toContain('cohort-orch');
    // A non-synthetic Modern host still reads as Modern (dotted), not solid CLI.
    expect(host.classList.contains('is-modern')).toBe(true);
    expect(host.getAttribute('data-squad-transport')).toBe('MODERN');
    expect(chipKind(host)).toBe('thread');
    fireEvent.click(host);
    expect(onInspect).toHaveBeenLastCalledWith(expect.objectContaining({
      card: expect.objectContaining({ modernThreadId: 't-lead', session: expect.objectContaining({ cohort: expect.objectContaining({ role: 'orchestrator', executionId: 'e-m' }) }) })
    }));
    const workers = Array.from(document.querySelectorAll('.agent-squad-worker'));
    expect(workers.map((button) => button.classList.contains('is-modern'))).toEqual([true]);
    expect(screen.queryByText('Lead thread')).toBeNull();
    expect(screen.queryByText('Writer thread')).toBeNull();
    expect(document.querySelectorAll('.agent-card.is-thread')).toHaveLength(1);
    fireEvent.click(workers[0]!);
    expect(onInspect).toHaveBeenLastCalledWith(expect.objectContaining({ card: expect.objectContaining({ modernThreadId: 't-work' }) }));
    // Right-click opens the thread menu for the member, never the lane's Close-all menu.
    fireEvent.contextMenu(workers[0]!);
    expect(document.querySelector('[data-testid="thread-context-menu"]')).toBeTruthy();
    expect(document.querySelectorAll('.tab-context-menu')).toHaveLength(1);
    expect(screen.queryByText(/Close all/)).toBeNull();
  });

  it('opens the agent card menu, not the lane menu, for a nested CLI squad worker', () => {
    const session = (id: string, role: 'orchestrator' | 'worker', title: string) => ({
      id, title, status: 'running', profile: 'claude', createdAt: 1,
      cohort: { cohortId: 'c1', teamId: 'cli', teamName: 'CLI squad', role, slotLabel: title }
    }) as TerminalSession;
    const card = (s: TerminalSession): AgentCard => ({ session: s, projectId: 'p', projectName: 'P', state: 'working', liveSubagents: 0 });
    render(
      <MemoryRouter>
        <AgentBoardLanes
          cards={[agentFleetItem(card(session('o1', 'orchestrator', 'Lead'))), agentFleetItem(card(session('w1', 'worker', 'Helper')))]}
          onInspect={vi.fn()}
        />
      </MemoryRouter>
    );
    fireEvent.contextMenu(cardButton('Helper'));
    expect(document.querySelector('[data-testid="thread-context-menu"]')).toBeNull();
    expect(document.querySelectorAll('.tab-context-menu')).toHaveLength(1);
    expect(screen.queryByText(/Close all/)).toBeNull();
  });
});
