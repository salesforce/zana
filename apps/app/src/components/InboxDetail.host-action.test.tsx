// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry, InboxHostAction } from '@zana-ai/zcc-domain/product';

const state = vi.hoisted(() => ({
  entry: {} as InboxEntry,
  action: undefined as InboxHostAction | undefined,
  hostActionsLoading: false,
  hostActionsError: false,
  reply: vi.fn(),
  create: vi.fn(),
  send: vi.fn(),
  hostRun: vi.fn(),
  readDecisionArtifact: vi.fn(),
  markAnswered: vi.fn(),
  resolve: vi.fn(),
  restore: vi.fn(),
  answered: false
}));

vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../store.js', () => ({
  useInbox: (pick: Function) => pick({ entries: [state.entry], loading: false }),
  useInboxSelection: (pick: Function) => pick({ selectedEntryId: state.entry.id, select: vi.fn() }),
  useInboxRead: (pick: Function) => pick({ markRead: vi.fn() }),
  useData: (pick: Function) => pick({ projects: [{ id: 'p', name: 'Project', path: '/project' }], terminals: { p: [{ id: 'terminal', title: 'Live terminal', status: 'running' }] }, structuredQuestionsEnabled: true, restoreTerminal: state.restore, createTerminal: state.create }),
  useUi: Object.assign((pick: Function) => pick({ setNav: vi.fn(), selectTab: vi.fn(), pushToast: vi.fn() }), { getState: () => ({ enterProjectFocus: vi.fn() }) }),
  useInboxKeep: (pick: Function) => pick({ keptIds: {} }),
  useSavedMark: (pick: Function) => pick({ savedEntryIds: {} }),
  useInboxAnswered: Object.assign((pick: Function) => pick({ answeredIds: state.answered ? { [state.entry.id]: true } : {} }), { getState: () => ({ markAnswered: state.markAnswered }) }),
  useInboxHostActions: (pick: Function) => pick({ byEntryId: state.action ? { [state.entry.id]: state.action } : {}, resolutionByEntryId: { [state.entry.id]: { loading: state.hostActionsLoading, error: state.hostActionsError, resolved: !state.hostActionsLoading && !state.hostActionsError } } }),
  useSuggestions: (pick: Function) => pick({ entries: [] }),
  deleteInboxEntry: vi.fn(), toggleInboxKeep: vi.fn(), saveInboxEntry: vi.fn(),
  replyToInboxEntry: state.reply, resolveInboxHostAction: state.resolve, runInboxHostAction: state.hostRun
}));
vi.mock('../lib/product-client.js', () => ({ product: {
  threads: { get: vi.fn().mockRejectedValue(Object.assign(new Error('missing'), { status: 404 })), send: state.send },
  fs: { readFile: vi.fn(async (path: string) => ({ ok: true, content: `contents of ${path}` })) },
  inbox: { hostActions: { readDecisionArtifact: state.readDecisionArtifact } }
} }));
vi.mock('./AgentLauncher.js', () => ({ AgentLauncher: () => null }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <p>{text}</p>, DocContent: () => null }));
vi.mock('../lib/renderReportHtml.js', () => ({ renderReportHtml: vi.fn() }));
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => 'actionable' }));
import { InboxDetail } from './InboxDetail.js';

const view = () => <MemoryRouter><InboxDetail visible /></MemoryRouter>;

describe('InboxDetail host-owned actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.entry = { id: 'host-entry', ts: 1, projectId: 'p', sessionId: 'terminal', subject: 'Worktree cleanup', comments: 'Choose action', question: { options: [{ id: 'delete', label: 'Delete' }] } };
    state.action = { entryId: 'host-entry', kind: 'worktree', status: 'pending' };
    state.hostActionsLoading = false;
    state.hostActionsError = false;
    state.answered = false;
    state.hostRun.mockResolvedValue(true);
    state.readDecisionArtifact.mockImplementation(async (_entryId: string, path: string) => ({ ok: true, value: { content: `contents of worktree/${path}` } }));
  });
  afterEach(cleanup);

  it.each([
    ['pending', undefined, false, 'Continue'],
    ['claimed', undefined, false, 'Host action is running.'],
    ['done', undefined, false, 'Host action completed.'],
    ['failed', 'Worktree has uncommitted changes. Clean or commit them, then try again.', false, 'Worktree has uncommitted changes. Clean or commit them, then try again.'],
    ['failed', 'This confirmation is unavailable.', true, 'This confirmation is unavailable.']
  ] as const)('renders %s host state without ordinary delivery fallback', async (status, message, unavailable, expected) => {
    state.action = { ...state.action!, status, ...(message ? { message } : {}), ...(unavailable ? { unavailable } : {}) };
    render(view());
    await screen.findByText(expected);
    expect(screen.queryByRole('button', { name: 'Open', exact: true })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Leave a reply|Reopen & answer|Send/ })).toBeNull();
    expect(state.reply).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });

  it('marks host entry answered after successful host delivery without terminal fallback', async () => {
    render(view());
    fireEvent.click(await screen.findByRole('radio', { name: /Delete/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await waitFor(() => expect(state.hostRun).toHaveBeenCalledWith('host-entry', { optionId: 'delete' }));
    expect(state.markAnswered).not.toHaveBeenCalled();
    expect(state.reply).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
  });

  it.each(['pending', 'failed'] as const)('keeps %s host form actionable despite ordinary answered marker', async (status) => {
    state.answered = true;
    state.action = { ...state.action!, status, message: 'Try again after checking the worktree.' };
    render(view());
    expect(await screen.findByRole('button', { name: 'Continue', exact: true })).toBeTruthy();
    expect(screen.queryByText('Answered Host action')).toBeNull();
  });

  it('suppresses fresh launch controls but retains existing terminal viewing', async () => {
    render(view());
    fireEvent.click(await screen.findByRole('button', { name: 'Open', exact: true }));
    expect(state.restore).toHaveBeenCalledWith('terminal', 'p');
    expect(screen.queryByRole('button', { name: 'Spawn a new agent seeded with this inbox entry' })).toBeNull();
    expect(screen.queryByText('New agent from this message')).toBeNull();
    expect(state.create).not.toHaveBeenCalled();
  });

  it('keeps plan diagnostics out of main content until Details opens', async () => {
    state.entry = {
      ...state.entry,
      subject: 'Plan correction required',
      comments: 'A submitted plan needs your review before work can continue.',
      decisionGuidance: {
        kind: 'plan-correction',
        diagnostic: 'parser expected a dependency',
        originalPlanPath: '.zana/execution-plan-e-1.md',
        correctedPlanPath: '.zana/execution-plan-corrected-e-1.md',
        diffPath: '.zana/execution-plan-diff-e-1.md'
      }
    };

    render(view());
    expect(screen.getByText('A submitted plan needs your review before work can continue.')).toBeTruthy();
    expect(screen.queryByText('parser expected a dependency')).toBeNull();
    expect(screen.queryByText('.zana/execution-plan-e-1.md')).toBeNull();
    expect(screen.queryByText('.zana/execution-plan-corrected-e-1.md')).toBeNull();
    expect(screen.queryByText('.zana/execution-plan-diff-e-1.md')).toBeNull();

    const details = screen.getByText('Details').closest('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));

    expect(screen.getByText('parser expected a dependency')).toBeTruthy();
    expect(screen.getByText('.zana/execution-plan-e-1.md')).toBeTruthy();
    expect(screen.getByText('.zana/execution-plan-corrected-e-1.md')).toBeTruthy();
    expect(screen.getByText('.zana/execution-plan-diff-e-1.md')).toBeTruthy();
    expect(await screen.findByText('contents of worktree/.zana/execution-plan-e-1.md')).toBeTruthy();
    expect(screen.getByText('contents of worktree/.zana/execution-plan-corrected-e-1.md')).toBeTruthy();
    expect(screen.getByText('contents of worktree/.zana/execution-plan-diff-e-1.md')).toBeTruthy();
    expect(state.readDecisionArtifact).toHaveBeenCalledWith('host-entry', '.zana/execution-plan-e-1.md');
  });

  it('keeps unexpected host failures generic outside Details', async () => {
    state.action = {
      ...state.action!,
      status: 'pending',
      message: 'Could not complete this decision. Try again.'
    };
    render(view());
    expect(await screen.findByText('Could not complete this decision. Try again.')).toBeTruthy();
    expect(screen.queryByText('/private/worktree secret failure')).toBeNull();
  });

  it('hides origin viewing when no existing host-owned origin remains', async () => {
    state.entry = { ...state.entry, sessionId: undefined };
    render(view());
    await screen.findByRole('button', { name: 'Continue', exact: true });
    expect(screen.queryByRole('button', { name: /Open|Reopen|Resume/, exact: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Spawn a new agent seeded with this inbox entry' })).toBeNull();
  });

  it.each([
    ['loading', 'Loading host action…'],
    ['error', 'Host action status is unavailable. Ordinary reply delivery is paused.']
  ] as const)('pauses ordinary delivery while host ownership is %s', async (phase, expected) => {
    state.hostActionsLoading = phase === 'loading';
    state.hostActionsError = phase === 'error';
    render(view());
    await screen.findByText(expected);
    expect(screen.queryByRole('button', { name: /Leave a reply|Reopen & answer|Send/ })).toBeNull();
    expect(state.reply).not.toHaveBeenCalled();
    expect(state.create).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });
});
