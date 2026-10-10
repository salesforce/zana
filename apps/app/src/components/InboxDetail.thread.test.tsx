// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const h = vi.hoisted(() => ({
  entry: {} as InboxEntry, terminals: [] as unknown[], compact: false,
  get: vi.fn(), send: vi.fn(), unarchive: vi.fn(), markAnswered: vi.fn(), toast: vi.fn(),
  create: vi.fn(), restore: vi.fn(), terminalReply: vi.fn(), focus: vi.fn()
}));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => h.compact }));
vi.mock('../store.js', () => ({
  useInbox: (pick: Function) => pick({ entries: [h.entry], loading: false }),
  useInboxSelection: (pick: Function) => pick({ selectedEntryId: h.entry.id, select: vi.fn() }),
  useInboxRead: (pick: Function) => pick({ markRead: vi.fn() }),
  useData: (pick: Function) => pick({ projects: [{ id: 'p', name: 'Project', path: '/project' }], terminals: { p: h.terminals }, structuredQuestionsEnabled: true, restoreTerminal: h.restore, createTerminal: h.create }),
  useUi: Object.assign((pick: Function) => pick({ setNav: vi.fn(), selectTab: vi.fn(), pushToast: h.toast }), { getState: () => ({ enterProjectFocus: h.focus }) }),
  useInboxKeep: (pick: Function) => pick({ keptIds: {} }),
  useSavedMark: (pick: Function) => pick({ savedEntryIds: {} }),
  useInboxAnswered: Object.assign((pick: Function) => pick({ answeredIds: {} }), { getState: () => ({ markAnswered: h.markAnswered }) }),
  useSuggestions: (pick: Function) => pick({ entries: [] }),
  deleteInboxEntry: vi.fn(), toggleInboxKeep: vi.fn(), saveInboxEntry: vi.fn(),
  replyToInboxEntry: h.terminalReply
}));
vi.mock('../lib/product-client.js', () => ({ product: { threads: { get: h.get, send: h.send, unarchive: h.unarchive } } }));
vi.mock('./AgentLauncher.js', () => ({ AgentLauncher: () => null }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <p>{text}</p>, DocContent: () => null }));
vi.mock('../lib/renderReportHtml.js', () => ({ renderReportHtml: vi.fn() }));
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => 'actionable' }));
import { InboxDetail } from './InboxDetail.js';
import { inboxThreadCache } from '../hooks/useInboxThread.js';

function Location() { return <output data-testid="location">{useLocation().pathname}</output>; }
const view = () => <MemoryRouter><InboxDetail visible /><Location /></MemoryRouter>;
beforeEach(() => {
  inboxThreadCache.clear();
  vi.resetAllMocks();
  h.compact = false; h.terminals = [];
  h.entry = { id: 'report', ts: 1, projectId: 'p', sessionId: 'thread', subject: 'Report', comments: 'Ready for your reply.' };
  h.get.mockResolvedValue({ thread: { id: 'thread', projectId: 'p', title: 'Original work', archivedAt: null } });
  h.send.mockResolvedValue({ ok: true });
  h.unarchive.mockResolvedValue({});
});
afterEach(cleanup);

it.each([false, true])('opens the original thread for legacy reports (compact=%s)', async (compact) => {
  h.compact = compact;
  render(view());
  await screen.findByText('Thread');
  fireEvent.click(screen.getByRole('button', { name: compact ? 'Open agent' : 'Open', exact: true }));
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/projects/p/threads/thread'));
  expect(h.create).not.toHaveBeenCalled();
  expect(h.restore).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
});

it('restores an archived thread when opening an explicit thread report', async () => {
  h.entry.origin = { threadId: 'thread' };
  h.get.mockResolvedValue({ thread: { id: 'thread', projectId: 'p', title: 'Original work', archivedAt: 1 } });
  render(view());
  await screen.findByText('Archived');
  fireEvent.click(screen.getByRole('button', { name: 'Reopen', exact: true }));
  await waitFor(() => expect(h.unarchive).toHaveBeenCalledWith('thread'));
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/projects/p/threads/thread'));
});

it('sends a reply to the thread and marks answered only after delivery', async () => {
  let deliver!: (value: { ok: boolean }) => void;
  h.send.mockReturnValue(new Promise((resolve) => { deliver = resolve; }));
  render(view());
  fireEvent.change(await screen.findByRole('textbox'), { target: { value: 'Continue the analysis' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  await waitFor(() => expect(h.send).toHaveBeenCalledWith('thread', 'Continue the analysis', 'queue-if-active'));
  expect(h.markAnswered).not.toHaveBeenCalled();
  deliver({ ok: true });
  await waitFor(() => expect(h.markAnswered).toHaveBeenCalledWith('report'));
  expect(h.terminalReply).not.toHaveBeenCalled();
  expect(h.create).not.toHaveBeenCalled();
  expect(screen.getByTestId('location').textContent).toBe('/');
});

it('delivers structured answers through the same thread path', async () => {
  h.entry.question = { options: [{ id: 'yes', label: 'Continue' }] };
  render(view());
  fireEvent.click(await screen.findByRole('radio', { name: /Continue/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
  await waitFor(() => expect(h.send).toHaveBeenCalledWith('thread', 'Continue', 'queue-if-active'));
  expect(h.terminalReply).not.toHaveBeenCalled();
});

it('retains a failed reply without marking it answered', async () => {
  h.send.mockRejectedValue(new Error('Host offline'));
  render(view());
  const input = await screen.findByRole('textbox');
  fireEvent.change(input, { target: { value: 'Keep this draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Host offline', 'error'));
  expect((input as HTMLTextAreaElement).value).toBe('Keep this draft');
  expect(h.markAnswered).not.toHaveBeenCalled();
});

it('refreshes the archived indicator after a reply restores the conversation', async () => {
  h.get.mockResolvedValueOnce({ thread: { id: 'thread', projectId: 'p', archivedAt: 1 } });
  h.get.mockResolvedValueOnce({ thread: { id: 'thread', projectId: 'p', archivedAt: 1 } });
  render(view());
  await screen.findByText('Archived');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Continue' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send', exact: true }));
  await screen.findByText('Thread');
  expect(h.unarchive).toHaveBeenCalledWith('thread');
  expect(h.markAnswered).toHaveBeenCalledWith('report');
});

it('displays open failures without navigating or launching a replacement', async () => {
  render(view());
  await screen.findByText('Thread');
  h.get.mockRejectedValue(new Error('Connection lost'));
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  await waitFor(() => expect(h.toast).toHaveBeenCalledWith('Connection lost', 'error'));
  expect(screen.getByTestId('location').textContent).toBe('/');
  expect(h.create).not.toHaveBeenCalled();
});

it('blocks actions during lookup and permits retry after a lookup error', async () => {
  h.get.mockRejectedValueOnce(new Error('Temporarily unavailable'));
  render(view());
  expect(screen.getByRole('button', { name: 'Open', exact: true }).hasAttribute('disabled')).toBe(true);
  await screen.findByRole('alert');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(h.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('textbox');
});

it('leaves live CLI reports on the existing terminal path', async () => {
  h.terminals = [{ id: 'thread', title: 'CLI agent', status: 'running' }];
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Open', exact: true }));
  expect(h.restore).toHaveBeenCalledWith('thread', 'p');
  expect(h.get).not.toHaveBeenCalled();
});

it('retains the legacy reopen path after a confirmed non-thread lookup', async () => {
  h.get.mockRejectedValue(Object.assign(new Error('missing'), { status: 404 }));
  render(view());
  await screen.findByRole('button', { name: 'Reopen', exact: true });
  fireEvent.click(screen.getByRole('button', { name: 'Leave a reply' }));
  expect(screen.getByRole('button', { name: 'Reopen & send' })).toBeTruthy();
});
