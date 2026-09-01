import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({
  closeTerminal: vi.fn(),
  closeIdleAgents: vi.fn(async () => ({ closed: 1, summarized: 1, followedUp: 1 }))
}));

vi.mock('../store.js', () => ({
  useData: Object.assign(
    (selector: (s: { closeTerminal: typeof h.closeTerminal }) => unknown) =>
      selector({ closeTerminal: h.closeTerminal }),
    {
      getState: () => ({
        closeTerminal: h.closeTerminal,
        closeIdleAgents: h.closeIdleAgents
      })
    }
  ),
  useIdleTriage: () => undefined
}));

import {
  AgentDeleteQuickAction,
  canCloseWithFollowup,
  closeAgentWithFollowup
} from './agentCardActions.js';

describe('AgentDeleteQuickAction', () => {
  it('renders a bin control to delete a live CLI agent', () => {
    const html = renderToStaticMarkup(
      <AgentDeleteQuickAction
        session={{ id: 's1', title: 'Hello', status: 'running' }}
        projectId="p1"
      />
    );
    expect(html).toContain('data-testid="agent-delete-quick"');
    expect(html).toContain('Delete Hello');
    expect(html).toContain('agent-delete-quick');
  });

  it('labels an exited row as dismiss', () => {
    const html = renderToStaticMarkup(
      <AgentDeleteQuickAction
        session={{ id: 's1', title: 'Hello', status: 'exited' }}
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
    expect(source).toContain('closeIdleAgents(projectId, [session.id], true)');
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
    const ok = await closeAgentWithFollowup({ id: 's1', title: 'Review' }, 'p1');
    expect(ok).toBe(true);
    expect(confirm).toHaveBeenCalled();
    expect(h.closeIdleAgents).toHaveBeenCalledWith('p1', ['s1'], true);
    vi.unstubAllGlobals();
  });

  it('returns false without closing when the user cancels', async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    h.closeIdleAgents.mockClear();
    const ok = await closeAgentWithFollowup({ id: 's1', title: 'Review' }, 'p1');
    expect(ok).toBe(false);
    expect(h.closeIdleAgents).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('CLI agent rail delete wiring', () => {
  it('shows a delete bin on workspace-rail CLI agents instead of a status dot', () => {
    const projects = readFileSync(new URL('./listpane/ProjectsList.tsx', import.meta.url), 'utf8');
    expect(projects).toContain('<AgentDeleteQuickAction session={session} projectId={projectId} />');
    expect(projects).not.toContain('agentActions.remove(sessionToCard(t, p))');
    expect(projects).not.toContain('AgentStatusDot');
  });
});
