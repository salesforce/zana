import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { MemoryRouter } from 'react-router-dom';

const h = vi.hoisted(() => ({
  closeTerminal: vi.fn(),
  closeIdleAgents: vi.fn(async () => ({ closed: 1, summarized: 1, followedUp: 1 })),
  closingFollowupIds: new Set<string>(),
  projects: [{ id: 'p1' }] as Array<Record<string, unknown>>,
  terminals: {} as Record<string, Array<Record<string, unknown>>>
}));

vi.mock('../store.js', () => ({
  useData: Object.assign(
    (selector: (s: {
      closeTerminal: typeof h.closeTerminal;
      closingFollowupIds: Set<string>;
      projects: unknown[];
      idleAttentionSensitivity: string;
    }) => unknown) =>
      selector({
        closeTerminal: h.closeTerminal,
        closingFollowupIds: h.closingFollowupIds,
        projects: h.projects,
        idleAttentionSensitivity: 'balanced'
      }),
    {
      getState: () => ({
        closeTerminal: h.closeTerminal,
        closeIdleAgents: h.closeIdleAgents,
        closingFollowupIds: h.closingFollowupIds,
        projects: h.projects,
        terminals: h.terminals
      })
    }
  ),
  useIdleTriage: () => undefined
}));

import {
  AgentCardMenu,
  AgentDeleteQuickAction,
  canCloseWithFollowup,
  cliAgentArchives,
  cliAgentKeepsHistory,
  cliAgentMenuProjectId,
  cliAgentRemoveConfirm,
  cliAgentRemoveLabel,
  cliAgentRemoveTitle,
  cliAgentRestartConfirm,
  cliAgentRestartLiveTitle,
  closeAgentWithFollowup,
  useAgentCardActions
} from './agentCardActions.js';

describe('cliAgentMenuProjectId', () => {
  it('uses the focused project when the shell is project-focused', () => {
    expect(cliAgentMenuProjectId({ isProjectFocused: true, focusedProjectId: 'p1' })).toBe('p1');
  });
});

describe('AgentDeleteQuickAction', () => {
  it('renders an Archive control for a live CLI agent', () => {
    const html = renderToStaticMarkup(
      <AgentDeleteQuickAction
        session={{ id: 's1', title: 'Hello', status: 'running', profile: 'claude' }}
        projectId="p1"
      />
    );
    expect(html).toContain('data-testid="agent-delete-quick"');
    expect(html).toContain('aria-label="Archive Hello"');
    expect(html).toContain('lucide-archive');
    expect(html).not.toContain('Delete Hello');
    expect(html).toContain('agent-delete-quick');
  });

  it('keeps the bin and Delete for a live plain shell', () => {
    const html = renderToStaticMarkup(
      <AgentDeleteQuickAction
        session={{ id: 's1', title: 'Hello', status: 'running', profile: 'shell' }}
        projectId="p1"
      />
    );
    expect(html).toContain('aria-label="Delete Hello"');
    expect(html).toContain('lucide-trash');
    expect(html).not.toContain('Archive Hello');
  });

  it('labels an exited row as dismiss', () => {
    const html = renderToStaticMarkup(
      <AgentDeleteQuickAction
        session={{ id: 's1', title: 'Hello', status: 'exited', profile: 'claude' }}
        projectId="p1"
      />
    );
    expect(html).toContain('Dismiss Hello');
    expect(html).not.toContain('Delete Hello');
  });

  it('closes the session without a confirm dialog', () => {
    const source = readFileSync(new URL('./agentCardActions.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('export function AgentDeleteQuickAction');
    const end = source.indexOf('export function clampMenuAnchor');
    const body = source.slice(start, end);
    expect(body).toContain('void closeTerminal(session.id, projectId)');
    expect(body).not.toContain('confirm');
    expect(body).not.toContain('actions.remove');
  });
});

describe('plugin agent card menu', () => {
  it('portals the right-click menu to document.body', () => {
    const source = readFileSync(new URL('./agentCardActions.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('export function AgentCardMenu');
    const end = source.indexOf('export function AgentDeleteQuickAction');
    const body = source.slice(start, end);
    expect(body).toContain('createPortal(node, document.body)');
    expect(body).toContain("typeof document === 'undefined'");
  });

  it('runs experimental_agentCardAction from the overflow menu', () => {
    const source = readFileSync(new URL('./agentCardActions.tsx', import.meta.url), 'utf8');
    expect(source).toContain('listAgentCardActions');
    expect(source).toContain('invokeAgentCardAction');
    expect(source).toContain('agent-card-plugin-');
  });

  it('offers Close with follow-up on live Claude-family cards', () => {
    const source = readFileSync(new URL('./agentCardActions.tsx', import.meta.url), 'utf8');
    expect(source).toContain('canCloseWithFollowup(card.session)');
    expect(source).toContain('actions.closeWithFollowup(card)');
    expect(source).toContain('Close with follow-up');
    expect(source).toContain("closingWithFollowup ? 'Closing…' : 'Close with follow-up'");
    expect(source).toContain('disabled={closingWithFollowup}');
    expect(source).toContain('closingFollowupIds.has(card.session.id)');
    expect(source).toContain('closeIdleAgents(projectId, [session.id], true, { force: true })');
    expect(source).toContain('Open in split');
    expect(source).toContain('openAgentSessionInSplit');
    expect(source).toContain('getAgentSessionRoutePath(card.session.id, menuProjectId)');
    expect(source).toContain('cliAgentMenuProjectId');
    expect(source).toContain('cliAgentRemoveLabel(card.session)');
    expect(source).toContain('cliAgentRestartLiveTitle()');
    expect(source).not.toContain('Kill and');
  });
});

describe('AgentCardMenu remove item', () => {
  function removeButton(session: Record<string, unknown>) {
    const card = {
      projectId: 'p1',
      state: 'idle',
      session: { id: 's1', title: 'Boss', status: 'running', profile: 'claude', ...session }
    } as never;
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <AgentCardMenu menu={{ card, x: 0, y: 0 }} setMenu={() => {}} actions={{} as never} />
      </MemoryRouter>
    );
    const match = /<button class="tab-context-danger" title="([^"]*)">([^<]*)<\/button>/.exec(html);
    return { title: match?.[1], label: match?.[2] };
  }

  it('archives a live agent with the History tooltip', () => {
    const button = removeButton({});
    expect(button.label).toBe('Archive');
    expect(button.title).toBe(
      'Stop the agent and remove it from the board. Its conversation stays in History.'
    );
  });

  it('uses neutral wording for a harness without History and for a remote project', () => {
    expect(removeButton({ profile: 'mastracode' }).title).toBe(NEUTRAL_TITLE);
    h.projects = [{ id: 'p1', remote: { host: 'h' } }];
    try {
      expect(removeButton({}).title).toBe(NEUTRAL_TITLE);
    } finally {
      h.projects = [{ id: 'p1' }];
    }
  });

  it('keeps Delete for a live plain shell', () => {
    const button = removeButton({ profile: 'shell' });
    expect(button.label).toBe('Delete');
    expect(button.title).toBe('Terminate this agent and remove it from the board');
  });

  it('keeps Dismiss for an exited card', () => {
    const button = removeButton({ status: 'exited' });
    expect(button.label).toBe('Dismiss');
    expect(button.title).toBe('Dismiss this finished agent from the board');
  });
});

describe('cliAgentArchives / cliAgentRemoveLabel', () => {
  it('archives live agents, deletes live shells and dismisses exited sessions', () => {
    const claude = { status: 'running', profile: 'claude' } as const;
    const codex = { status: 'running', profile: 'codex' } as const;
    const shell = { status: 'running', profile: 'shell' } as const;
    expect(cliAgentArchives(claude)).toBe(true);
    expect(cliAgentArchives(codex)).toBe(true);
    expect(cliAgentArchives(shell)).toBe(false);
    expect(cliAgentArchives({ status: 'exited', profile: 'claude' })).toBe(false);
    expect(cliAgentRemoveLabel(claude)).toBe('Archive');
    expect(cliAgentRemoveLabel(codex)).toBe('Archive');
    expect(cliAgentRemoveLabel(shell)).toBe('Delete');
    expect(cliAgentRemoveLabel({ status: 'exited', profile: 'claude' })).toBe('Dismiss');
    expect(cliAgentRemoveLabel({ status: 'exited', profile: 'shell' })).toBe('Dismiss');
  });
});

const HISTORY_TITLE = 'Stop the agent and remove it from the board. Its conversation stays in History.';
const NEUTRAL_TITLE = 'Stop the agent and remove it from the board.';

describe('cliAgentKeepsHistory', () => {
  const local = {};
  const remote = { remote: { host: 'h' } };
  const hosted = { hostId: 'host-2' };
  it('is true for a live agent with a History adapter in a local project, all postures', () => {
    for (const profile of ['claude', 'claude-yolo', 'cursor', 'codex-resume', 'pi', 'opencode', 'grok'] as const) {
      expect(cliAgentKeepsHistory({ status: 'running', profile }, local)).toBe(true);
    }
  });
  it('is false for harnesses without an adapter', () => {
    expect(cliAgentKeepsHistory({ status: 'running', profile: 'mastracode' }, local)).toBe(false);
    expect(cliAgentKeepsHistory({ status: 'running', profile: 'afcode-yolo' }, local)).toBe(false);
  });
  it('is false for remote, other-host and unknown projects', () => {
    expect(cliAgentKeepsHistory({ status: 'running', profile: 'claude' }, remote)).toBe(false);
    expect(cliAgentKeepsHistory({ status: 'running', profile: 'claude' }, hosted)).toBe(false);
    expect(cliAgentKeepsHistory({ status: 'running', profile: 'claude' }, undefined)).toBe(false);
  });
  it('is false for shells and exited sessions', () => {
    expect(cliAgentKeepsHistory({ status: 'running', profile: 'shell' }, local)).toBe(false);
    expect(cliAgentKeepsHistory({ status: 'exited', profile: 'claude' }, local)).toBe(false);
  });
});

describe('cliAgentRemoveTitle', () => {
  const live = { status: 'running', profile: 'claude' } as never;
  const shell = { status: 'running', profile: 'shell' } as never;
  const exited = { status: 'exited', profile: 'claude' } as never;

  it('board: archive, shell and exited wording', () => {
    expect(cliAgentRemoveTitle(live, 'board', true)).toBe(HISTORY_TITLE);
    expect(cliAgentRemoveTitle(live, 'board')).toBe(NEUTRAL_TITLE);
    expect(cliAgentRemoveTitle(shell, 'board')).toBe('Terminate this agent and remove it from the board');
    expect(cliAgentRemoveTitle(exited, 'board')).toBe('Dismiss this finished agent from the board');
  });

  it('modal: archive and shell wording', () => {
    expect(cliAgentRemoveTitle(live, 'modal', true)).toBe(HISTORY_TITLE);
    expect(cliAgentRemoveTitle(live, 'modal')).toBe(NEUTRAL_TITLE);
    expect(cliAgentRemoveTitle(shell, 'modal')).toBe("Terminate the agent's process and close this view");
  });

  it('focus: short labels, Dismiss for exited', () => {
    expect(cliAgentRemoveTitle(live, 'focus')).toBe('Archive (stops the agent)');
    expect(cliAgentRemoveTitle(shell, 'focus')).toBe('Delete (ends the process)');
    expect(cliAgentRemoveTitle(exited, 'focus')).toBe('Dismiss');
  });

  it('tab: removes the tab', () => {
    expect(cliAgentRemoveTitle(live, 'tab', true)).toBe(
      'Stop the agent and remove the tab. Its conversation stays in History.'
    );
    expect(cliAgentRemoveTitle(live, 'tab')).toBe('Stop the agent and remove the tab.');
    expect(cliAgentRemoveTitle(shell, 'tab')).toBe('Terminate this session and remove the tab. Reopen with ⌘⇧T.');
    expect(cliAgentRemoveTitle(exited, 'tab')).toBe('Terminate this session and remove the tab. Reopen with ⌘⇧T.');
  });
});

describe('cliAgentRemoveConfirm', () => {
  it('is neutral by default and tells an agent it stays in History only when asked', () => {
    expect(cliAgentRemoveConfirm({ title: 'Review', profile: 'claude' })).toBe(
      'Archive “Review”? The agent stops and is removed from the board.'
    );
    expect(cliAgentRemoveConfirm({ title: 'Review', profile: 'claude' }, true)).toBe(
      'Archive “Review”? The agent stops and its conversation stays in History.'
    );
  });

  it('keeps the Delete wording for a plain shell', () => {
    const text = cliAgentRemoveConfirm({ title: 'Review', profile: 'shell' });
    expect(text).toBe('Delete “Review”? The process will be terminated.');
    expect(text).not.toMatch(/Stop/);
  });
});

function captureActions(confirm: () => boolean) {
  vi.stubGlobal('window', { confirm });
  let actions!: ReturnType<typeof useAgentCardActions>['actions'];
  function Probe() {
    actions = useAgentCardActions().actions;
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return actions;
}

describe('useAgentCardActions remove', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => h.closeTerminal.mockClear());

  const card = (session: Record<string, unknown>) =>
    ({ projectId: 'p1', session: { id: 's1', title: 'Boss', status: 'running', profile: 'claude', ...session } }) as never;
  const lead = { cohort: { role: 'orchestrator', teamName: 'Crew' } };

  it('warns that archiving an agent lead also stops its team', () => {
    const confirm = vi.fn(() => false);
    const actions = captureActions(confirm);
    actions.remove(card(lead));
    expect(confirm).toHaveBeenCalledWith(
      'Archive “Boss”? It\'s the orchestrator, so archiving it also stops every other agent in “Crew”. Their conversations stay in History.'
    );
    expect(h.closeTerminal).not.toHaveBeenCalled();
  });

  const LEAD_NEUTRAL =
    'Archive “Boss”? It\'s the orchestrator, so archiving it also stops every other agent in “Crew”.';

  it('drops the History sentence for a lead whose harness has no History', () => {
    const confirm = vi.fn(() => false);
    captureActions(confirm).remove(card({ ...lead, profile: 'mastracode' }));
    expect(confirm).toHaveBeenCalledWith(LEAD_NEUTRAL);
  });

  it('drops the History sentence in a remote project', () => {
    h.projects = [{ id: 'p1', remote: { host: 'h' } }];
    const confirm = vi.fn(() => false);
    try {
      captureActions(confirm).remove(card(lead));
    } finally {
      h.projects = [{ id: 'p1' }];
    }
    expect(confirm).toHaveBeenCalledWith(LEAD_NEUTRAL);
  });

  it('drops the History sentence when a live teammate has no History, ignoring exited and other cohorts', () => {
    const teamLead = { cohort: { role: 'orchestrator', teamName: 'Crew', cohortId: 'c1' } };
    const member = (id: string, profile: string, status: string, cohortId: string) => ({
      id, profile, status, cohort: { role: 'worker', cohortId }
    });
    h.terminals = {
      p1: [
        member('w1', 'claude', 'running', 'c1'),
        member('w2', 'mastracode', 'exited', 'c1'),
        member('w3', 'mastracode', 'running', 'c2')
      ]
    };
    const confirm = vi.fn(() => false);
    try {
      captureActions(confirm).remove(card(teamLead));
      expect(confirm).toHaveBeenLastCalledWith(
        LEAD_NEUTRAL + ' Their conversations stay in History.'
      );
      h.terminals = { p1: [member('w4', 'mastracode', 'running', 'c1')] };
      captureActions(confirm).remove(card(teamLead));
      expect(confirm).toHaveBeenLastCalledWith(LEAD_NEUTRAL);
    } finally {
      h.terminals = {};
    }
  });

  it('keeps the Close wording for a shell lead (reachable: a live shell does not archive)', () => {
    const confirm = vi.fn(() => false);
    const actions = captureActions(confirm);
    actions.remove(card({ ...lead, profile: 'shell' }));
    expect(confirm).toHaveBeenCalledWith(
      'Close “Boss”? It\'s the orchestrator — closing it will also stop every other agent in “Crew”.'
    );
  });

  it('uses neutral wording for a non-lead in a remote project', () => {
    h.projects = [{ id: 'p1', remote: { host: 'h' } }];
    const confirm = vi.fn(() => false);
    try {
      captureActions(confirm).remove(card({}));
    } finally {
      h.projects = [{ id: 'p1' }];
    }
    expect(confirm).toHaveBeenCalledWith('Archive “Boss”? The agent stops and is removed from the board.');
  });

  it('uses the shared confirm for a non-lead and closes when accepted', () => {
    const confirm = vi.fn(() => true);
    const actions = captureActions(confirm);
    actions.remove(card({}));
    expect(confirm).toHaveBeenCalledWith(
      'Archive “Boss”? The agent stops and its conversation stays in History.'
    );
    expect(h.closeTerminal).toHaveBeenCalledWith('s1', 'p1');
  });

  it('closes an exited card without a prompt', () => {
    const confirm = vi.fn(() => true);
    const actions = captureActions(confirm);
    actions.remove(card({ status: 'exited' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(h.closeTerminal).toHaveBeenCalledWith('s1', 'p1');
  });
});

describe('cliAgentRestart copy', () => {
  it('mentions stopping the process without Kill', () => {
    expect(cliAgentRestartLiveTitle()).toBe(
      'Stop the process and relaunch this session with the same profile and args'
    );
    expect(cliAgentRestartConfirm('Hello')).toBe('Stop the process and relaunch "Hello"?');
    expect(cliAgentRestartLiveTitle()).not.toMatch(/Kill/i);
    expect(cliAgentRestartConfirm('Hello')).not.toMatch(/Kill/i);
  });
});

describe('canCloseWithFollowup', () => {
  it('allows a live Claude session and rejects shells and exited sessions', () => {
    expect(canCloseWithFollowup({ status: 'running', profile: 'claude' })).toBe(true);
    expect(canCloseWithFollowup({ status: 'running', profile: 'shell' })).toBe(false);
    expect(canCloseWithFollowup({ status: 'exited', profile: 'claude' })).toBe(false);
  });
});

describe('closeAgentWithFollowup', () => {
  it('confirms then closes with summarize=true', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    h.closeIdleAgents.mockClear();
    h.closingFollowupIds.clear();
    const ok = await closeAgentWithFollowup({ id: 's1', title: 'Review' }, 'p1');
    expect(ok).toBe(true);
    expect(confirm).toHaveBeenCalled();
    expect(h.closeIdleAgents).toHaveBeenCalledWith('p1', ['s1'], true, { force: true });
    vi.unstubAllGlobals();
  });

  it('returns false without closing when the user cancels', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    h.closeIdleAgents.mockClear();
    h.closingFollowupIds.clear();
    const ok = await closeAgentWithFollowup({ id: 's1', title: 'Review' }, 'p1');
    expect(ok).toBe(false);
    expect(h.closeIdleAgents).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('returns false without confirming when the session is already closing', async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    h.closeIdleAgents.mockClear();
    h.closingFollowupIds.add('s1');
    const ok = await closeAgentWithFollowup({ id: 's1', title: 'Review' }, 'p1');
    expect(ok).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(h.closeIdleAgents).not.toHaveBeenCalled();
    h.closingFollowupIds.clear();
    vi.unstubAllGlobals();
  });
});

describe('CLI agent rail delete wiring', () => {
  it('shows a delete bin on workspace-rail CLI agents instead of a status dot', () => {
    const projects = readFileSync(new URL('./listpane/ProjectsList.tsx', import.meta.url), 'utf8');
    const rows = readFileSync(new URL('./listpane/project-session-rail-rows.tsx', import.meta.url), 'utf8');
    expect(rows).toContain('<AgentDeleteQuickAction session={session} projectId={projectId} />');
    expect(projects).not.toContain('agentActions.remove(sessionToCard(t, p))');
    expect(projects).not.toContain('AgentStatusDot');
  });
});
