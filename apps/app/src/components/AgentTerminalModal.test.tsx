// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry, TerminalSession } from '@zana-ai/zcc-domain/product';

const state = vi.hoisted(() => ({
  entries: [] as unknown[],
  answeredIds: {} as Record<string, boolean>,
  structuredQuestions: true,
  heartbeatEnabled: false,
  catchUpEnabled: false,
  catchUpDelay: 20,
  catchUpResult: undefined as unknown,
  since: undefined as number | undefined,
  hostAction: undefined as unknown,
  ownership: undefined as unknown,
  resolve: vi.fn(),
  setHeartbeat: vi.fn(),
  clear: vi.fn(),
  apply: vi.fn(),
  generate: vi.fn(),
  toggleFullScreen: vi.fn(),
  fullScreen: false
}));

vi.mock('../lib/product-client.js', () => ({
  product: { terminals: { generateCatchUpSummary: state.generate } }
}));
vi.mock('../store.js', () => ({
  useData: Object.assign(
    (pick: Function) => pick({
      heartbeatEnabled: state.heartbeatEnabled,
      structuredQuestionsEnabled: state.structuredQuestions,
      catchUpSummaryEnabled: state.catchUpEnabled,
      catchUpSummaryDelaySeconds: state.catchUpDelay,
      projects: [{ id: 'p', name: 'Project' }]
    }),
    { getState: () => ({ setHeartbeat: state.setHeartbeat }) }
  ),
  useAgentStatus: (pick: Function) => pick({ since: state.since ? { s1: state.since } : {} }),
  useCatchUpSummary: Object.assign(
    (pick: Function) => pick({ bySession: state.catchUpResult ? { s1: state.catchUpResult } : {} }),
    { getState: () => ({ clear: state.clear, apply: state.apply }) }
  ),
  useInbox: (pick: Function) => pick({ entries: state.entries }),
  useInboxAnswered: (pick: Function) => pick({ answeredIds: state.answeredIds })
}));
vi.mock('../stores/live.js', () => ({
  resolveInboxHostAction: state.resolve,
  useInboxHostActions: (pick: Function) => pick({
    byEntryId: state.hostAction ? { q1: state.hostAction } : {},
    resolutionByEntryId: state.ownership ? { q1: state.ownership } : {}
  })
}));
vi.mock('./InboxQuestionBlock.js', () => ({
  QuestionBlock: ({ prompt }: { prompt: string }) => <form data-testid="question-block">{prompt}</form>
}));
vi.mock('./AgentSessionView.js', () => ({
  AgentSessionView: (props: { footer: unknown; stageChrome: unknown; stageOverlay: unknown }) => (
    <div data-testid="session-view">
      <div data-testid="stage-chrome">{props.stageChrome as never}</div>
      <div data-testid="stage-overlay">{props.stageOverlay as never}</div>
      <div data-testid="footer">{props.footer as never}</div>
    </div>
  )
}));
vi.mock('./AgentSessionActions.js', () => ({
  AgentSessionActions: ({ onSessionClosed }: { onSessionClosed: () => void }) => (
    <button type="button" onClick={onSessionClosed}>Session closed</button>
  )
}));
vi.mock('./AgentReportPanel.js', () => ({ AgentReportPanel: () => <div data-testid="report-panel" /> }));
vi.mock('./AgentInsights.js', () => ({ useSessionStats: () => null }));
vi.mock('./FavoriteStar.js', () => ({ FavoriteStar: () => null }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <p>{text}</p> }));
vi.mock('./InspectorResizeHandles.js', () => ({ InspectorResizeHandles: () => <div data-testid="resize-handles" /> }));
vi.mock('./useInspectorWindow.js', () => ({
  useInspectorWindow: () => ({
    ref: { current: null },
    className: 'win',
    style: {},
    fullScreen: state.fullScreen,
    toggleFullScreen: state.toggleFullScreen,
    beginResize: vi.fn(), moveResize: vi.fn(), endResize: vi.fn(), resetFrame: vi.fn(), keyResize: vi.fn()
  })
}));
import { AgentTerminalModal } from './AgentTerminalModal.js';

const session = { id: 's1', title: 'Worker', status: 'running', profile: 'shell' } as unknown as TerminalSession;
const question = (over: Partial<InboxEntry> = {}): InboxEntry => ({
  id: 'q1', ts: 1, projectId: 'p', sessionId: 's1', comments: 'Which way?',
  question: { options: [{ id: 'a', label: 'A' }] },
  ...over
} as unknown as InboxEntry);

function renderModal(over: { state?: 'idle' | 'working' | 'blocked'; sess?: TerminalSession; onClose?: () => void } = {}) {
  const onClose = over.onClose ?? vi.fn();
  render(
    <AgentTerminalModal
      session={over.sess ?? session}
      projectId="p"
      projectName="Project"
      state={over.state ?? 'working'}
      onClose={onClose}
    />
  );
  return onClose;
}

describe('AgentTerminalModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.entries = [];
    state.answeredIds = {};
    state.structuredQuestions = true;
    state.heartbeatEnabled = false;
    state.catchUpEnabled = false;
    state.catchUpResult = undefined;
    state.since = undefined;
    state.hostAction = undefined;
    state.ownership = { loading: false, error: false, resolved: true };
    state.fullScreen = false;
  });
  afterEach(cleanup);

  describe('chrome', () => {
    it('renders the dialog, state badge and window controls', () => {
      renderModal({ state: 'blocked' });
      expect(screen.getByRole('dialog', { name: 'Agent Worker' })).toBeTruthy();
      expect(screen.getByTestId('agent-modal-state').textContent).toContain('Needs you');
      expect(screen.getByTestId('agent-modal-state').getAttribute('data-state')).toBe('blocked');
      expect(screen.getByTestId('session-view')).toBeTruthy();
      expect(screen.getByTestId('resize-handles')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
      expect(state.toggleFullScreen).toHaveBeenCalledTimes(1);
    });

    it('hides the state badge once the session exited', () => {
      renderModal({ sess: { ...session, status: 'exited' } as TerminalSession });
      expect(screen.queryByTestId('agent-modal-state')).toBeNull();
    });

    it('closes via the close button and backdrop but not on window clicks', () => {
      const onClose = renderModal();
      fireEvent.click(screen.getByRole('dialog'));
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(onClose).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole('dialog').parentElement!);
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('forwards session actions closing to onClose', () => {
      const onClose = renderModal();
      fireEvent.click(screen.getByRole('button', { name: 'Session closed' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('toggles the report overlay and counts this session\'s reports', () => {
      state.entries = [
        { id: 'r1', ts: 1, sessionId: 's1', report: true, subject: 'R' },
        { id: 'r2', ts: 2, sessionId: 'other', report: true, subject: 'R2' }
      ];
      renderModal();
      const tab = screen.getByRole('tab', { name: /Report/ });
      expect(screen.queryByTestId('report-panel')).toBeNull();
      fireEvent.click(tab);
      expect(screen.getByTestId('report-panel')).toBeTruthy();
      expect(tab.getAttribute('aria-selected')).toBe('true');
      fireEvent.click(tab);
      expect(screen.queryByTestId('report-panel')).toBeNull();
    });
  });

  describe('pending question', () => {
    it('renders the answer form for a non-host-owned pending question and resolves ownership', async () => {
      state.entries = [question()];
      renderModal();
      expect((await screen.findByTestId('question-block')).textContent).toBe('Which way?');
      expect(screen.queryByText('Answer this host action in Inbox.')).toBeNull();
      expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'q1' }));
    });

    it('falls back to the entry title when the question has no comment text', async () => {
      state.entries = [question({ comments: '  ', subject: 'Pick one' })];
      renderModal();
      expect((await screen.findByTestId('question-block')).textContent).toBe('Pick one');
    });

    it('shows the checking state while ownership is unresolved', () => {
      state.entries = [question()];
      state.ownership = undefined;
      renderModal();
      expect(screen.getByRole('status').textContent).toContain('Checking question owner');
      expect(screen.queryByTestId('question-block')).toBeNull();
    });

    it('sends host-owned entries to Inbox without a question block', () => {
      state.entries = [question()];
      state.hostAction = { entryId: 'q1', kind: 'worktree', status: 'pending' };
      renderModal();
      expect(screen.getByText('Answer this host action in Inbox.')).toBeTruthy();
      expect(screen.queryByTestId('question-block')).toBeNull();
    });

    it('fences hostActionRequired entries and ownership lookup errors', () => {
      state.entries = [question({ hostActionRequired: true } as Partial<InboxEntry>)];
      renderModal();
      expect(screen.getByText('Answer this host action in Inbox.')).toBeTruthy();
      expect(screen.queryByTestId('question-block')).toBeNull();
      cleanup();

      state.entries = [question()];
      state.ownership = { loading: false, error: true, resolved: false };
      renderModal();
      expect(screen.getByText('Answer this host action in Inbox.')).toBeTruthy();
      expect(screen.queryByTestId('question-block')).toBeNull();
    });

    it.each([
      ['structured questions disabled', () => { state.structuredQuestions = false; state.entries = [question()]; }],
      ['already answered', () => { state.answeredIds = { q1: true }; state.entries = [question()]; }],
      ['another session', () => { state.entries = [question({ sessionId: 'other' })]; }],
      ['no structured question', () => { state.entries = [question({ question: undefined })]; }]
    ])('renders nothing when %s', (_name, setup) => {
      setup();
      renderModal();
      expect(screen.queryByTestId('question-block')).toBeNull();
      expect(screen.queryByText('Answer this host action in Inbox.')).toBeNull();
      expect(screen.queryByText(/Checking question owner/)).toBeNull();
      expect(state.resolve).not.toHaveBeenCalled();
    });

    it('hides the question while the report overlay is open', () => {
      state.entries = [question()];
      renderModal();
      fireEvent.click(screen.getByRole('tab', { name: /Report/ }));
      expect(screen.queryByTestId('question-block')).toBeNull();
    });
  });

  describe('catch-up summary', () => {
    const icon = (name: RegExp | string) => screen.queryByRole('button', { name });

    it('is hidden when disabled or the agent is working', () => {
      state.catchUpResult = { ok: true, text: 'Headline' };
      renderModal({ state: 'idle' });
      expect(icon('Catch-up summary available')).toBeNull();
      cleanup();
      state.catchUpEnabled = true;
      renderModal({ state: 'working' });
      expect(icon('Catch-up summary available')).toBeNull();
    });

    it('is hidden before the dwell threshold with no result', () => {
      state.catchUpEnabled = true;
      state.since = Date.now() - 1000;
      renderModal({ state: 'idle' });
      expect(screen.queryByRole('button', { name: /summary/i })).toBeNull();
    });

    it('shows a pending shimmer once dwell passes the threshold', () => {
      state.catchUpEnabled = true;
      state.since = Date.now() - 60_000;
      renderModal({ state: 'idle' });
      fireEvent.click(screen.getByRole('button', { name: 'Generating catch-up summary…' }));
      expect(screen.getByRole('dialog', { name: 'Catch-up summary' })).toBeTruthy();
    });

    it('shows headline and body for a successful result, then refreshes and dismisses', async () => {
      state.catchUpEnabled = true;
      state.catchUpResult = { ok: true, text: '## Headline\nBody line' };
      state.generate.mockResolvedValue({ ok: true, text: 'fresh' });
      renderModal({ state: 'blocked' });
      fireEvent.click(screen.getByRole('button', { name: 'Catch-up summary available' }));
      expect(screen.getByText('Headline')).toBeTruthy();
      expect(screen.getByText('Body line')).toBeTruthy();

      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh summary' })); });
      expect(state.generate).toHaveBeenCalledWith('p', 's1');
      await waitFor(() => expect(state.apply).toHaveBeenCalledWith({ ok: true, text: 'fresh' }));

      fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
      expect(state.clear).toHaveBeenCalledWith('s1');
      expect(screen.queryByRole('dialog', { name: 'Catch-up summary' })).toBeNull();
    });

    it('offers retry for a failed result', async () => {
      state.catchUpEnabled = true;
      state.catchUpResult = { ok: false };
      state.generate.mockResolvedValue({ ok: true, text: 'ok' });
      renderModal({ state: 'idle' });
      fireEvent.click(screen.getByRole('button', { name: "Couldn't generate a summary — click to retry" }));
      expect(screen.getByText("Couldn't generate a summary.")).toBeTruthy();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })); });
      expect(state.generate).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(state.apply).toHaveBeenCalled());
    });

    it('closes the popover on Escape and outside click', () => {
      state.catchUpEnabled = true;
      state.catchUpResult = { ok: true, text: 'Only headline' };
      renderModal({ state: 'idle' });
      const open = () => fireEvent.click(screen.getByRole('button', { name: 'Catch-up summary available' }));
      open();
      expect(screen.getByRole('dialog', { name: 'Catch-up summary' })).toBeTruthy();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Catch-up summary' })).toBeNull();
      open();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('dialog', { name: 'Catch-up summary' })).toBeNull();
    });
  });
});
