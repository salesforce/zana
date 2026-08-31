import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({
  closeTerminal: vi.fn()
}));

vi.mock('../store.js', () => ({
  useData: (selector: (s: { closeTerminal: typeof h.closeTerminal }) => unknown) =>
    selector({ closeTerminal: h.closeTerminal }),
  useIdleTriage: () => undefined
}));

import { AgentDeleteQuickAction } from './agentCardActions.js';

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
});

describe('CLI agent rail delete wiring', () => {
  it('shows a delete bin on workspace-rail CLI agents instead of a status dot', () => {
    const projects = readFileSync(new URL('./listpane/ProjectsList.tsx', import.meta.url), 'utf8');
    expect(projects).toContain('<AgentDeleteQuickAction session={session} projectId={projectId} />');
    expect(projects).not.toContain('agentActions.remove(sessionToCard(t, p))');
    expect(projects).not.toContain('AgentStatusDot');
  });
});
