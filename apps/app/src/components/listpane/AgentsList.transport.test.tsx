// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  terminals: {} as Record<string, unknown[]>,
  threads: [] as unknown[],
  // Stable ref: the list's execution poll re-subscribes whenever `projects` changes.
  projects: [{ id: 'p', name: 'Proj' }],
  teams: [
    { id: 'modern', name: 'Modern squad', slots: [], transport: 'MODERN' },
    { id: 'cli', name: 'CLI squad', slots: [] }
  ]
}));

vi.mock('@/store', () => ({
  useData: (selector: (state: object) => unknown) => selector({
    terminals: h.terminals, projects: h.projects, agentListNeedsYouFromTriage: false, idleAttentionSensitivity: 'medium',
    agentsListOrganization: 'status'
  }),
  useUi: Object.assign(
    (selector: (state: object) => unknown) => selector({ selectedTabId: {}, selectedProjectId: null }),
    { getState: () => ({ setAgentsBoardView: vi.fn() }) }
  ),
  useAgentStatus: (selector: (state: object) => unknown) => selector({ byId: {} }),
  useIdleTriage: (selector: (state: object) => unknown) => selector({ byId: {} }),
  useTeams: (selector: (state: { teams: unknown[] }) => unknown) => selector({ teams: h.teams }),
  usePersonas: (selector: (state: { personas: unknown[] }) => unknown) => selector({ personas: [{ id: 'researcher', name: 'Researcher' }] }),
  openWhatsNewAll: vi.fn()
}));
vi.mock('@/thread-store', () => ({
  useThreads: (selector: (state: { threads: unknown[]; load: () => void }) => unknown) =>
    selector({ threads: h.threads, load: () => undefined })
}));
vi.mock('@/hooks/useEnsureThreads', () => ({ useEnsureThreads: () => undefined }));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/lib/profileIcon', () => ({ profileIcon: () => null }));
vi.mock('@/lib/sessionBuckets', () => ({ isRecentlyFinished: () => false }));
vi.mock('@/components/AgentBoard', async () => {
  const actual = await vi.importActual<typeof import('@/components/AgentBoard')>('@/components/AgentBoard');
  return { ...actual, idleSurfacesToNeedsYou: () => false };
});
vi.mock('@/components/AgentLauncher', () => ({ AgentLauncher: () => null }));
vi.mock('@/components/agentCardActions', () => ({ useAgentCardActions: () => ({ menu: null, setMenu: vi.fn(), actions: {}, rename: null, closeRename: vi.fn(), submitRename: vi.fn() }), AgentCardMenu: () => null, clampMenuAnchor: vi.fn() }));
vi.mock('@/components/PromptModal', () => ({ PromptModal: () => null }));
vi.mock('@/components/ListPaneResizer', () => ({ ListPaneResizer: () => null }));

import { AgentsListPane } from './AgentsList.js';

const execution = (executionId: string, teamId: string, jobTitle: string) => ({
  executionId, projectId: 'p', teamId, jobTitle, state: 'RUNNING', attempt: 1, createdAt: 1, updatedAt: 2
});

describe('AgentsListPane squad transport', () => {
  beforeEach(() => {
    h.terminals = {};
    h.threads = [];
    (window as unknown as { cc: unknown }).cc = {
      executionBoard: { listProject: vi.fn().mockResolvedValue({ executions: [] }) }
    };
  });
  afterEach(cleanup);

  it('labels a Modern squad Job row Thread with the dotted modifier; a CLI squad Job stays CLI Agent', async () => {
    (window as unknown as { cc: { executionBoard: { listProject: ReturnType<typeof vi.fn> } } }).cc.executionBoard.listProject
      .mockResolvedValue({ executions: [execution('e-m', 'modern', 'Modern job'), execution('e-c', 'cli', 'CLI job')] });
    // The list renders rows only once at least one live agent exists.
    h.terminals = { p: [{ id: 'solo', title: 'Solo', status: 'running', profile: 'claude', createdAt: Date.now() }] };
    render(<MemoryRouter><AgentsListPane /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Modern job')).toBeTruthy());
    const modern = screen.getByText('Modern job').closest('button')!;
    expect(modern.querySelector('.fleet-kind-chip')?.getAttribute('data-kind')).toBe('thread');
    expect(modern.classList.contains('is-modern')).toBe(true);
    expect(modern.getAttribute('data-squad-transport')).toBe('MODERN');
    const cli = screen.getByText('CLI job').closest('button')!;
    expect(cli.querySelector('.fleet-kind-chip')?.getAttribute('data-kind')).toBe('agent');
    expect(cli.classList.contains('is-modern')).toBe(false);
  });

  it('keeps live squad sessions (even of a Modern-tagged team) and their nested workers CLI Agent', async () => {
    (window as unknown as { cc: { executionBoard: { listProject: ReturnType<typeof vi.fn> } } }).cc.executionBoard.listProject
      .mockResolvedValue({ executions: [execution('e-x', 'modern', 'Live job')] });
    const session = (id: string, role: 'orchestrator' | 'worker', title: string) => ({
      id, title, status: 'running', profile: 'claude', createdAt: Date.now(),
      cohort: { cohortId: 'c1', teamId: 'modern', teamName: 'Modern squad', role, slotLabel: title, executionId: 'e-x' }
    });
    h.terminals = { p: [session('o1', 'orchestrator', 'Lead'), session('w1', 'worker', 'Helper')] };
    render(<MemoryRouter><AgentsListPane /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Live job')).toBeTruthy());
    const lead = screen.getByText('Live job').closest('button')!;
    expect(lead.querySelector('.fleet-kind-chip')?.getAttribute('data-kind')).toBe('agent');
    expect(lead.classList.contains('is-modern')).toBe(false);
    expect(lead.getAttribute('data-squad-transport')).toBe('CLI');
    const worker = screen.getByText('Helper').closest('button')!;
    expect(worker.className).toContain('agents-worker-row');
    expect(worker.querySelector('.fleet-kind-chip')?.textContent).toBe('CLI Agent');
  });

  it('groups Modern squad members like a CLI squad and drops them from the thread list', async () => {
    (window as unknown as { cc: { executionBoard: { listProject: ReturnType<typeof vi.fn> } } }).cc.executionBoard.listProject
      .mockResolvedValue({ executions: [{
        ...execution('e-m', 'modern', 'Modern job'),
        modernMembers: [
          { threadId: 't-orch', slotId: 'orchestrator', personaId: 'lead', role: 'orchestrator', live: true },
          { threadId: 't-work', slotId: 'researcher', personaId: 'researcher', role: 'worker', live: true }
        ]
      }] });
    h.threads = [
      { id: 't-work', projectId: 'p', hostId: 'h', environmentId: null, providerId: 'claude', status: 'idle', title: 'Research thread', createdAt: 5, cwd: null, branchName: null, isWorktree: false },
      { id: 't-plain', projectId: 'p', hostId: 'h', environmentId: null, providerId: 'claude', status: 'idle', title: 'Plain thread', createdAt: 6, cwd: null, branchName: null, isWorktree: false }
    ];
    h.terminals = { p: [{ id: 'solo', title: 'Solo', status: 'running', profile: 'claude', createdAt: Date.now() }] };
    let path = '';
    function Probe() { path = useLocation().pathname; return null; }
    render(<MemoryRouter><AgentsListPane /><Probe /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Modern job')).toBeTruthy());
    expect(screen.getByText('Plain thread')).toBeTruthy();
    // The member thread renders once, as a nested worker, not as a standalone thread entry.
    expect(screen.queryByText('Research thread')).toBeNull();
    const worker = screen.getByText('Researcher').closest('button')!;
    expect(worker.className).toContain('agents-worker-row');
    expect(worker.querySelector('.fleet-kind-chip')?.getAttribute('data-kind')).toBe('thread');
    expect(worker.classList.contains('is-modern')).toBe(true);
    const hostRow = screen.getByText('Modern job').closest('[data-squad-transport]')!;
    expect(hostRow.getAttribute('data-squad-transport')).toBe('MODERN');
    expect(hostRow.classList.contains('is-modern')).toBe(true);
    // The live Modern orchestrator hosts the Job row like a CLI coordinator; it is not nested.
    expect(screen.queryByText('Orchestrator')).toBeNull();
    expect(screen.queryByText('Background')).toBeNull();
    // Thread-native context menu, never the PTY agent menu.
    fireEvent.contextMenu(worker);
    expect(document.querySelector('[data-testid="thread-context-menu"]')).toBeTruthy();
    expect(document.querySelectorAll('.tab-context-menu')).toHaveLength(1);
    fireEvent.click(worker);
    expect(path).toContain('t-work');
  });
});
