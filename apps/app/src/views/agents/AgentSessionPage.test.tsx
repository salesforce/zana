/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const setHeartbeat = vi.fn();
const session = {
  id: 's1',
  title: 'PTY agent',
  status: 'running',
  profile: 'claude',
  cwd: '/tmp/proj',
  createdAt: 1,
  pid: 1,
  heartbeat: false
} as TerminalSession;

const store = {
  terminals: { p1: [session] } as Record<string, TerminalSession[]>,
  projects: [{ id: 'p1', name: 'Demo', color: '#111' }],
  heartbeatEnabled: false,
  setHeartbeat
};

let supportsHooks = false;

const agentStatus = { byId: { s1: 'working' } as Record<string, string> };

vi.mock('../../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof store) => unknown) => selector(store),
    { getState: () => store }
  ),
  useAgentStatus: (selector: (s: typeof agentStatus) => unknown) => selector(agentStatus)
}));

vi.mock('../../components/AgentSessionView.js', () => ({
  AgentSessionView: (props: {
    terminalAnchorId: string;
    session: TerminalSession;
    heartbeat: { checked: boolean; onToggle: () => void } | null;
    showProject?: boolean;
    projectName?: string;
    projectRemote?: boolean;
    state?: string;
    footer?: ReactNode;
  }) => (
    <div
      data-testid="agent-session-view"
      data-anchor={props.terminalAnchorId}
      data-heartbeat={props.heartbeat ? 'on' : 'off'}
      data-show-project={props.showProject ? 'yes' : 'no'}
      data-project-name={props.projectName}
      data-project-remote={props.projectRemote ? 'yes' : 'no'}
      data-state={props.state}
    >
      {props.session.title}
      {props.heartbeat ? (
        <button type="button" data-testid="heartbeat-toggle" onClick={props.heartbeat.onToggle}>
          heartbeat
        </button>
      ) : null}
      {props.footer}
    </div>
  )
}));

vi.mock('../../components/AgentSessionActions.js', () => ({
  AgentSessionActions: () => <button type="button">Delete</button>
}));

vi.mock('@zana-ai/zcc-domain/launch-provider', () => ({
  providerCapabilities: () => ({ supportsHooks })
}));

import { AgentSessionPage } from './AgentSessionPage.js';

describe('AgentSessionPage', () => {
  afterEach(() => {
    cleanup();
    store.heartbeatEnabled = false;
    supportsHooks = false;
    session.status = 'running';
    session.scheduled = undefined;
    session.headless = undefined;
    session.heartbeat = false;
    store.projects = [{ id: 'p1', name: 'Demo', color: '#111' }];
    agentStatus.byId = { s1: 'working' };
    setHeartbeat.mockReset();
  });

  it('renders AgentSessionView when the session exists', () => {
    const html = renderToStaticMarkup(<AgentSessionPage projectId="p1" sessionId="s1" />);
    expect(html).toContain('data-testid="agent-session-view"');
    expect(html).toContain('cc-terminal-anchor-agent-session-s1');
    expect(html).toContain('PTY agent');
    expect(html).toContain('data-heartbeat="off"');
    expect(html).toContain('data-show-project="yes"');
    expect(html).toContain('data-project-name="Demo"');
    expect(html).toContain('Delete');
    expect(html).not.toContain('data-testid="agent-session-missing"');
  });

  it('wires heartbeat when hooks are supported and the toggle is enabled', () => {
    store.heartbeatEnabled = true;
    supportsHooks = true;
    render(<AgentSessionPage projectId="p1" sessionId="s1" />);
    expect(screen.getByTestId('agent-session-view').getAttribute('data-heartbeat')).toBe('on');
    fireEvent.click(screen.getByTestId('heartbeat-toggle'));
    expect(setHeartbeat).toHaveBeenCalledWith('s1', 'p1', true);
    cleanup();
    session.heartbeat = true;
    render(<AgentSessionPage projectId="p1" sessionId="s1" />);
    fireEvent.click(screen.getByTestId('heartbeat-toggle'));
    expect(setHeartbeat).toHaveBeenCalledWith('s1', 'p1', false);
  });

  it('does not offer heartbeat for scheduled, headless, or exited sessions', () => {
    store.heartbeatEnabled = true;
    supportsHooks = true;
    session.scheduled = true;
    expect(renderToStaticMarkup(<AgentSessionPage projectId="p1" sessionId="s1" />)).toContain(
      'data-heartbeat="off"'
    );
    session.scheduled = undefined;
    session.headless = true;
    expect(renderToStaticMarkup(<AgentSessionPage projectId="p1" sessionId="s1" />)).toContain(
      'data-heartbeat="off"'
    );
    session.headless = undefined;
    session.status = 'exited';
    expect(renderToStaticMarkup(<AgentSessionPage projectId="p1" sessionId="s1" />)).toContain(
      'data-heartbeat="off"'
    );
  });

  it('shows an empty state when the session is gone', () => {
    const html = renderToStaticMarkup(<AgentSessionPage projectId="p1" sessionId="missing" />);
    expect(html).toContain('data-testid="agent-session-missing"');
    expect(html).toContain('This CLI agent is no longer running.');
    expect(html).not.toContain('data-testid="agent-session-view"');
    expect(renderToStaticMarkup(<AgentSessionPage projectId="gone" sessionId="s1" />)).toContain(
      'data-testid="agent-session-missing"'
    );
  });

  it('falls back when the project and agent status are unknown', () => {
    store.projects = [];
    agentStatus.byId = {};
    const html = renderToStaticMarkup(<AgentSessionPage projectId="p1" sessionId="s1" />);
    expect(html).toContain('data-project-name="Unknown"');
    expect(html).toContain('data-project-remote="no"');
    expect(html).toContain('data-state="unknown"');
  });

  it('finds the session by id when the route has no project', () => {
    const html = renderToStaticMarkup(<AgentSessionPage projectId={null} sessionId="s1" />);
    expect(html).toContain('data-testid="agent-session-view"');
    expect(html).toContain('data-project-name="Demo"');
    expect(html).not.toContain('data-testid="agent-session-missing"');
  });
});
