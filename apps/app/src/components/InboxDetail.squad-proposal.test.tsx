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
  review: vi.fn(),
  launcherProps: [] as Array<Record<string, unknown>>,
  markAnswered: vi.fn(),
  resolve: vi.fn(),
  restore: vi.fn(),
  answered: false,
  projects: [{ id: 'p', name: 'Project', path: '/project' }]
}));

vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => false }));
vi.mock('../store.js', () => ({
  useInbox: (pick: Function) => pick({ entries: [state.entry], loading: false }),
  useInboxSelection: (pick: Function) => pick({ selectedEntryId: state.entry.id, select: vi.fn() }),
  useInboxRead: (pick: Function) => pick({ markRead: vi.fn() }),
  useData: (pick: Function) => pick({ projects: state.projects, terminals: { p: [{ id: 'terminal', title: 'Live terminal', status: 'running' }] }, structuredQuestionsEnabled: true, restoreTerminal: state.restore, createTerminal: state.create }),
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
  inbox: { hostActions: { readDecisionArtifact: state.readDecisionArtifact } },
  teams: { reviewProposal: state.review }
} }));
vi.mock('./AgentLauncher.js', () => ({
  AgentLauncher: (props: Record<string, unknown>) => {
    state.launcherProps.push(props);
    return <button type="button" onClick={props.onClose as () => void}>close launcher</button>;
  }
}));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <p>{text}</p>, DocContent: () => null }));
vi.mock('../lib/renderReportHtml.js', () => ({ renderReportHtml: vi.fn() }));
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => 'actionable' }));
import { InboxDetail } from './InboxDetail.js';

const view = () => <MemoryRouter><InboxDetail visible /></MemoryRouter>;
const prefill = {
  proposalId: 'prop-1', projectId: 'p', teamId: 't', coordinationMode: 'freeform' as const, goal: 'Do it', sources: []
};

describe('InboxDetail Squad proposal card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.launcherProps = [];
    state.entry = { id: 'sq', ts: 1, projectId: 'p', sessionId: 'terminal', subject: 'Squad launch ready', comments: 'Ready', squadProposal: { proposalId: 'prop-1' }, question: { options: [{ id: 'dismiss', label: 'Dismiss' }] } };
    state.action = { entryId: 'sq', kind: 'squad-proposal', status: 'pending' };
    state.hostActionsLoading = false;
    state.hostActionsError = false;
    state.answered = false;
    state.projects = [{ id: 'p', name: 'Project', path: '/project' }];
    state.hostRun.mockResolvedValue(true);
  });
  afterEach(cleanup);

  it('Review opens the Squad composer pre-filled and refreshes the card when it closes', async () => {
    state.review.mockResolvedValue({ ok: true, value: prefill });
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Review Squad launch' }));
    await screen.findByRole('button', { name: 'close launcher' });
    expect(state.review).toHaveBeenCalledWith('prop-1');
    expect(state.launcherProps.at(-1)).toMatchObject({ initialMode: 'team', squadPrefill: prefill });
    state.resolve.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'close launcher' }));
    expect(state.resolve).toHaveBeenCalledWith(state.entry);
    expect(screen.queryByRole('button', { name: 'close launcher' })).toBeNull();
  });

  it('shows the error, keeps the launcher closed and refreshes the card when Review fails', async () => {
    state.review.mockResolvedValue({ ok: false, code: 'EXPIRED', message: 'This proposal expired.' });
    render(view());
    state.resolve.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Review Squad launch' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This proposal expired.');
    expect(state.launcherProps).toHaveLength(0);
    expect(state.resolve).toHaveBeenCalledWith(state.entry);
  });

  it('shows a thrown review error and refreshes the card', async () => {
    state.review.mockRejectedValue(new Error('ipc down'));
    render(view());
    state.resolve.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Review Squad launch' }));
    expect((await screen.findByRole('alert')).textContent).toBe('ipc down');
    expect(state.resolve).toHaveBeenCalledWith(state.entry);
  });

  it('styles Review as the primary action', () => {
    render(view());
    expect(screen.getByRole('button', { name: 'Review Squad launch' }).className).toBe('btn primary');
  });

  it('says it is checking the Squad launch until the first lookup lands', () => {
    state.hostActionsLoading = true;
    state.action = undefined;
    render(view());
    expect(screen.getByText('Checking this Squad launch…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review Squad launch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('keeps the buttons mounted while a known action is re-resolved, so focus is not lost', () => {
    state.hostActionsLoading = true;
    render(view());
    expect(screen.getByRole('button', { name: 'Review Squad launch' })).toBeTruthy();
    expect(screen.queryByText('Checking this Squad launch…')).toBeNull();
  });

  it('offers Retry instead of the buttons when the lookup failed, in plain words', () => {
    state.hostActionsError = true;
    render(view());
    expect(screen.getByText(/Couldn't check this Squad launch\./)).toBeTruthy();
    expect(screen.queryByText(/Host action/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.resolve).toHaveBeenCalledWith(state.entry);
    expect(screen.queryByRole('button', { name: 'Review Squad launch' })).toBeNull();
  });

  it.each(['pending', 'failed'] as const)('shows main\'s reason on a %s action and keeps the buttons', (status) => {
    state.action = { ...state.action!, status, message: 'This Squad launch is starting.' };
    render(view());
    expect(screen.getByRole('alert').textContent).toBe('This Squad launch is starting.');
    expect(screen.getByRole('button', { name: 'Review Squad launch' })).toBeTruthy();
  });

  it('prefers main\'s reason over the generic text when Dismiss did not go through', async () => {
    state.hostRun.mockResolvedValue(false);
    state.action = { ...state.action!, message: 'This Squad launch is starting.' };
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(state.hostRun).toHaveBeenCalled());
    expect(screen.getAllByRole('alert').map((n) => n.textContent)).toEqual(['This Squad launch is starting.']);
  });

  it('shows the card as no longer available when main has no action for it', () => {
    state.action = undefined;
    render(view());
    expect(screen.getByText('This Squad launch is no longer available.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('disables Review while the request is in flight', async () => {
    let finish: (value: unknown) => void = () => undefined;
    state.review.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Review Squad launch' }));
    const busy = await screen.findByRole('button', { name: 'Opening…' });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: false, code: 'EXPIRED', message: 'gone' });
    await screen.findByRole('alert');
  });

  it('shows the proposal summary as the card body', () => {
    state.entry = { ...state.entry, comments: '- Squad: Crew (Lead + 3 workers)\n- Planning: Plan provided in goal' };
    render(view());
    expect(screen.getByText(/Squad: Crew \(Lead \+ 3 workers\)/)).toBeTruthy();
  });

  it('names the conversation once, in the Context line, not again in the card text', () => {
    state.entry = { ...state.entry, intent: 'Prepared in "Design chat"' };
    render(view());
    expect(screen.getAllByText(/Prepared in "Design chat"/)).toHaveLength(1);
    expect(screen.getByText('Review opens the Squad composer filled in. Nothing starts until you press Launch.')).toBeTruthy();
  });

  it('Dismiss runs the host dismiss action', async () => {
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(state.hostRun).toHaveBeenCalledWith('sq', { optionId: 'dismiss' });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('tells the user when Dismiss did not go through', async () => {
    state.hostRun.mockResolvedValue(false);
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This Squad launch could not be dismissed. Try again.');
  });

  it('shows a retry message, not the IPC error, and re-enables Dismiss when the host action throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    state.hostRun.mockRejectedValue(new Error("Error invoking remote method 'inbox:hostAction': boom"));
    render(view());
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect((await screen.findByRole('alert')).textContent).toBe('This Squad launch could not be dismissed. Try again.');
    expect((screen.getByRole('button', { name: 'Dismiss' }) as HTMLButtonElement).disabled).toBe(false);
    expect(warn).toHaveBeenCalledWith('[inbox] squad proposal dismiss failed', expect.any(Error));
    warn.mockRestore();
  });

  it.each([
    [{ unavailable: true, message: 'This Squad launch has expired.' }, 'This Squad launch has expired.'],
    [{ status: 'done' as const, message: 'Squad launched.' }, 'Squad launched.']
  ])('shows the host message and hides the buttons when unavailable (%#)', (patch, text) => {
    state.action = { ...state.action!, ...patch };
    render(view());
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review Squad launch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('never renders the generic question block', () => {
    render(view());
    expect(screen.queryByRole('button', { name: /Continue|Send|Leave a reply/ })).toBeNull();
    expect(document.querySelector('.inbox-question')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open', exact: true })).toBeTruthy();
  });
});
