/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

const closeTerminal = vi.fn();
const summarizeSession = vi.fn(async (): Promise<void> => {});
const clearBlocked = vi.fn();
const clearTriage = vi.fn();
const closeAgentWithFollowup = vi.fn(async (..._args: unknown[]) => true);
const canCloseWithFollowup = vi.fn((..._args: unknown[]) => true);
const idleSurfacesToNeedsYou = vi.fn((..._args: unknown[]) => false);
const dataState = {
  catchUpSummaryEnabled: true,
  idleAttentionSensitivity: 'medium'
};

vi.mock('../lib/product-client.js', () => ({
  product: { terminals: { clearAgentBlocked: (...args: unknown[]) => clearBlocked(...args) } }
}));

vi.mock('../store.js', () => ({
  useData: Object.assign(
    (selector: (s: typeof dataState) => unknown) => selector(dataState),
    { getState: () => ({ closeTerminal, summarizeSession }) }
  ),
  useIdleTriage: Object.assign(
    (selector: (s: { byId: Record<string, { resolution: string; confidence: number }> }) => unknown) =>
      selector({ byId: { s1: { resolution: 'needs-you', confidence: 1 } } }),
    { getState: () => ({ clear: clearTriage }) }
  )
}));

vi.mock('./agentCardActions.js', () => ({
  canCloseWithFollowup: (...args: unknown[]) => canCloseWithFollowup(...args),
  closeAgentWithFollowup: (...args: unknown[]) => closeAgentWithFollowup(...args),
  cliAgentRemoveLabel: (exited: boolean) => (exited ? 'Dismiss' : 'Delete'),
  cliAgentDeleteConfirm: (title: string) => `Delete “${title}”? The process will be terminated.`
}));

vi.mock('./AgentBoard.js', () => ({
  idleSurfacesToNeedsYou: (...args: unknown[]) => idleSurfacesToNeedsYou(...args)
}));

vi.mock('../lib/launchProfile.js', () => ({
  isClaudeProfile: () => true
}));

import { AgentSessionActions } from './AgentSessionActions.js';

function session(over: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 's1',
    title: 'PTY agent',
    status: 'running',
    profile: 'claude',
    cwd: '/tmp',
    createdAt: 1,
    ...over
  } as TerminalSession;
}

describe('AgentSessionActions', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn(() => true));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    closeTerminal.mockReset();
    summarizeSession.mockReset();
    clearBlocked.mockReset();
    clearTriage.mockReset();
    closeAgentWithFollowup.mockReset();
    closeAgentWithFollowup.mockResolvedValue(true);
    canCloseWithFollowup.mockReset();
    canCloseWithFollowup.mockReturnValue(true);
    idleSurfacesToNeedsYou.mockReset();
    idleSurfacesToNeedsYou.mockReturnValue(false);
    dataState.catchUpSummaryEnabled = true;
  });

  it('offers close, follow-up, and summarize on a live Claude session', () => {
    render(<AgentSessionActions session={session()} projectId="p1" state="idle" />);
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.getByText('Close with follow-up')).toBeTruthy();
    expect(screen.getByText('Summarize to inbox')).toBeTruthy();
  });

  it('shows Mark as Idle when the agent is blocked', () => {
    render(<AgentSessionActions session={session()} projectId="p1" state="blocked" />);
    fireEvent.click(screen.getByText('Mark as Idle'));
    expect(clearBlocked).toHaveBeenCalledWith('p1', 's1');
    expect(clearTriage).toHaveBeenCalledWith('s1');
  });

  it('shows Mark as Idle when idle triage surfaces attention', () => {
    idleSurfacesToNeedsYou.mockReturnValue(true);
    render(<AgentSessionActions session={session()} projectId="p1" state="idle" />);
    expect(screen.getByText('Mark as Idle')).toBeTruthy();
  });

  it('hides follow-up and summarize when those paths are unavailable', () => {
    canCloseWithFollowup.mockReturnValue(false);
    dataState.catchUpSummaryEnabled = false;
    render(<AgentSessionActions session={session()} projectId="p1" state="idle" />);
    expect(screen.getByText('Delete')).toBeTruthy();
    expect(screen.queryByText('Close with follow-up')).toBeNull();
    expect(screen.queryByText('Summarize to inbox')).toBeNull();
  });

  it('ignores a second follow-up or summarize click while the first is in flight', async () => {
    let resolveClose: ((value: boolean) => void) | undefined;
    closeAgentWithFollowup.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveClose = resolve;
        })
    );
    let resolveSummary: (() => void) | undefined;
    summarizeSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSummary = resolve;
        })
    );
    render(<AgentSessionActions session={session()} projectId="p1" state="idle" />);
    fireEvent.click(screen.getByText('Close with follow-up'));
    fireEvent.click(screen.getByText('Closing…'));
    expect(closeAgentWithFollowup).toHaveBeenCalledTimes(1);
    resolveClose?.(true);
    await waitFor(() => expect(screen.getByText('Close with follow-up')).toBeTruthy());

    fireEvent.click(screen.getByText('Summarize to inbox'));
    fireEvent.click(screen.getByText('Summarizing…'));
    expect(summarizeSession).toHaveBeenCalledTimes(1);
    resolveSummary?.();
    await waitFor(() => expect(screen.getByText('Summarize to inbox')).toBeTruthy());
  });

  it('terminates the process after confirm and notifies the host', () => {
    const onSessionClosed = vi.fn();
    vi.mocked(window.confirm).mockReturnValue(true);
    render(
      <AgentSessionActions
        session={session()}
        projectId="p1"
        state="idle"
        onSessionClosed={onSessionClosed}
      />
    );
    fireEvent.click(screen.getByText('Delete'));
    expect(window.confirm).toHaveBeenCalledWith(
      'Delete “PTY agent”? The process will be terminated.'
    );
    expect(closeTerminal).toHaveBeenCalledWith('s1', 'p1');
    expect(onSessionClosed).toHaveBeenCalled();
  });

  it('does not terminate when the confirm is cancelled', () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    render(<AgentSessionActions session={session()} projectId="p1" state="idle" />);
    fireEvent.click(screen.getByText('Delete'));
    expect(closeTerminal).not.toHaveBeenCalled();
  });

  it('leaves the page open when follow-up close is cancelled', async () => {
    closeAgentWithFollowup.mockResolvedValue(false);
    const onSessionClosed = vi.fn();
    render(
      <AgentSessionActions
        session={session()}
        projectId="p1"
        state="idle"
        onSessionClosed={onSessionClosed}
      />
    );
    fireEvent.click(screen.getByText('Close with follow-up'));
    await waitFor(() => expect(closeAgentWithFollowup).toHaveBeenCalled());
    expect(onSessionClosed).not.toHaveBeenCalled();
  });

  it('files a follow-up close and summarizes to the inbox', async () => {
    const onSessionClosed = vi.fn();
    render(
      <AgentSessionActions
        session={session()}
        projectId="p1"
        state="idle"
        onSessionClosed={onSessionClosed}
      />
    );
    fireEvent.click(screen.getByText('Close with follow-up'));
    await waitFor(() => expect(closeAgentWithFollowup).toHaveBeenCalled());
    expect(onSessionClosed).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Summarize to inbox'));
    await waitFor(() => expect(summarizeSession).toHaveBeenCalledWith('s1', 'p1'));
  });

  it('hides live-only actions once the session has exited', () => {
    render(
      <AgentSessionActions session={session({ status: 'exited' })} projectId="p1" state="done" />
    );
    expect(screen.queryByText('Delete')).toBeNull();
    expect(screen.queryByText('Close with follow-up')).toBeNull();
    expect(screen.getByText('Summarize to inbox')).toBeTruthy();
  });
});
