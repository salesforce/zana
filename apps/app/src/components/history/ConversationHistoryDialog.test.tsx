// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
const mocks = vi.hoisted(() => ({
  history: vi.fn(), timeline: vi.fn(), unarchive: vi.fn(), start: vi.fn(), page: vi.fn(), release: vi.fn(), transcript: vi.fn(), resume: vi.fn(),
  navigate: vi.fn(), desktop: vi.fn(() => true)
}));
vi.mock('../../lib/product-client.js', () => ({ product: { threads: { history: mocks.history, timeline: mocks.timeline, unarchive: mocks.unarchive }, history: { start: mocks.start, page: mocks.page, release: mocks.release, transcript: mocks.transcript, resume: mocks.resume } } }));
vi.mock('../../lib/app-surface.js', () => ({ hasDesktopBridge: mocks.desktop }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('../../store.js', () => ({ useData: (select: (s: unknown) => unknown) => select({ projects: [{ id: 'p', name: 'My project' }, { id: 'other', name: 'Other project' }] }) }));
import { ConversationHistoryDialog, HistoryBrowser } from './ConversationHistoryDialog.js';
import { ArchivedThreadBanner } from './ArchivedThreadBanner.js';
import { useConversationHistory } from './history-store.js';
const thread = { id: 't', projectId: 'p', providerId: 'codex', title: 'Saved work', updatedAt: 1, archivedAt: 2 };
const row = { historyId: 'opaque', source: 'codex', title: 'Saved CLI work', projectName: 'My project', lastActiveAt: 1, availability: 'available', fidelity: 'exact-native-id' };
const snapshot = { snapshotId: 'snapshot', status: 'ready', rows: [row], coverage: [], hasNextPage: false };
beforeEach(() => {
  vi.clearAllMocks(); mocks.desktop.mockReturnValue(true);
  mocks.history.mockResolvedValue({ rows: [thread] }); mocks.unarchive.mockResolvedValue({ thread: {} });
  mocks.timeline.mockResolvedValue({ rows: [{ kind: 'conversation', role: 'user', text: 'My saved question' }, { kind: 'conversation', role: 'assistant', text: 'Thread saved answer' }] });
  mocks.start.mockResolvedValue(snapshot); mocks.page.mockResolvedValue(snapshot); mocks.release.mockResolvedValue(undefined);
  mocks.transcript.mockResolvedValue({ messages: [{ role: 'user', text: 'My question' }, { role: 'assistant', text: 'Saved answer' }], truncated: false });
  mocks.resume.mockResolvedValue({ ok: true, value: { id: 'session', projectId: 'p' } });
  useConversationHistory.getState().close();
});
afterEach(cleanup);

it('distinguishes identically titled threads by their own harness and project', async () => {
  mocks.history.mockResolvedValue({ rows: [thread, { ...thread, id: 't2', projectId: 'other', providerId: 'acp-opencode' }] });
  render(<HistoryBrowser initialTab="threads" />);
  const rows = await screen.findAllByRole('button', { name: /^Saved work/ });
  expect(within(rows[0]).getByTitle('Harness: Codex')).toBeTruthy();
  expect(within(rows[0]).getByTitle('Project: My project')).toBeTruthy();
  expect(within(rows[1]).getByTitle('Harness: OpenCode')).toBeTruthy();
  expect(within(rows[1]).getByTitle('Project: Other project')).toBeTruthy();
});

it('shows the selected CLI harness and project in both its row and transcript preview', async () => {
  mocks.start.mockResolvedValue({ ...snapshot, rows: [row, { ...row, historyId: 'other', source: 'claude', projectName: 'Other project' }] });
  render(<HistoryBrowser initialTab="cli" />);
  const rows = await screen.findAllByRole('button', { name: /^Saved CLI work/ });
  expect(within(rows[0]).getByTitle('Harness: Codex')).toBeTruthy();
  expect(within(rows[0]).getByTitle('Project: My project')).toBeTruthy();
  expect(within(rows[1]).getByTitle('Harness: Claude Code')).toBeTruthy();
  expect(within(rows[1]).getByTitle('Project: Other project')).toBeTruthy();
  fireEvent.click(rows[1]);
  const preview = within(screen.getByRole('region', { name: 'Saved conversation' }));
  expect(preview.getByTitle('Harness: Claude Code')).toBeTruthy();
  expect(preview.getByTitle('Project: Other project')).toBeTruthy();
  await preview.findByText('Saved answer');
  fireEvent.click(rows[0]);
  expect(preview.getByTitle('Harness: Codex')).toBeTruthy();
  expect(preview.getByTitle('Project: My project')).toBeTruthy();
  expect(preview.queryByTitle('Project: Other project')).toBeNull();
  await preview.findByText('Saved answer');
});

it('opens global and project history from the shared store and closes accessibly', async () => {
  render(<ConversationHistoryDialog />); expect(screen.queryByRole('dialog')).toBeNull();
  useConversationHistory.getState().open('p');
  await screen.findByRole('dialog', { name: 'Conversation history' });
  expect((screen.getByLabelText('History project') as HTMLSelectElement).value).toBe('p');
  fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('reads archived history without starting a process and restores before navigating', async () => {
  render(<HistoryBrowser initialTab="threads" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Saved work/ }));
  await screen.findByText('Thread saved answer');
  expect(mocks.navigate).not.toHaveBeenCalled(); expect(mocks.unarchive).not.toHaveBeenCalled();
  expect(mocks.timeline).toHaveBeenCalledWith('t', { segmentLimit: 20, includeNestedRows: 'true', summaryOnly: 'false' });
  const preview = within(screen.getByRole('region', { name: 'Saved conversation' }));
  expect(preview.getByTitle('Harness: Codex')).toBeTruthy();
  expect(preview.getByTitle('Project: My project')).toBeTruthy();
  fireEvent.click(preview.getByRole('button', { name: 'Restore conversation' }));
  await waitFor(() => expect(mocks.unarchive).toHaveBeenCalledWith('t'));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
});

it('filters, searches and paginates history and ignores a stale response', async () => {
  mocks.history.mockResolvedValueOnce({ rows: [thread], nextOffset: 40 }).mockResolvedValueOnce({ rows: [{ ...thread, id: 't2', title: 'Older work' }] });
  render(<HistoryBrowser initialTab="threads" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
  await screen.findByText('Older work'); expect(screen.getByText('Saved work')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Thread history status'), { target: { value: 'archived' } });
  fireEvent.change(screen.getByLabelText('History project'), { target: { value: 'other' } });
  fireEvent.change(screen.getByLabelText('Search conversation history'), { target: { value: 'needle' } });
  await waitFor(() => expect(mocks.history).toHaveBeenLastCalledWith(expect.objectContaining({ projectId: 'other', query: 'needle' })));
  let resolve!: (value: unknown) => void;
  mocks.history.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  mocks.history.mockResolvedValue({ rows: [] });
  fireEvent.change(screen.getByLabelText('Thread history status'), { target: { value: 'active' } });
  await screen.findByText('No conversations match these filters.');
  resolve({ rows: [thread] });
  await waitFor(() => expect(screen.queryByText('Saved work')).toBeNull());
});

it('keeps missing-environment history readable and reports restore and fetch failures', async () => {
  mocks.history.mockResolvedValueOnce({ rows: [{ ...thread, unavailableReason: 'Missing environment' }, { ...thread, id: 't2', title: 'Restorable' }] });
  mocks.unarchive.mockRejectedValue(new Error('Provider offline'));
  render(<HistoryBrowser initialTab="threads" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Saved work/ }));
  await screen.findByText('Thread saved answer');
  expect((screen.getByRole('button', { name: 'Restore conversation' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Open conversation' }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: /^Restorable/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore conversation' })); await screen.findByText('Provider offline'); expect(mocks.navigate).not.toHaveBeenCalled();
  mocks.history.mockRejectedValue(new Error('History unavailable'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' })); await screen.findByText('History unavailable');
});

it('reads native transcripts and resumes the exact selected row in its original project', async () => {
  render(<HistoryBrowser initialTab="cli" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Saved CLI work/ }));
  await screen.findByText('Saved answer');
  expect(mocks.transcript).toHaveBeenCalledWith('snapshot', 'opaque');
  expect(mocks.resume).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Resume conversation' }));
  await waitFor(() => expect(mocks.resume).toHaveBeenCalledWith('snapshot', 'opaque'));
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('session')));
});

it('does not navigate or start fresh when exact resume fails', async () => {
  mocks.resume.mockResolvedValue({ ok: false, message: 'Native conversation missing' });
  render(<HistoryBrowser initialTab="cli" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Saved CLI work/ }));
  await screen.findByText('Saved answer'); fireEvent.click(screen.getByRole('button', { name: 'Resume conversation' }));
  await screen.findByText('Native conversation missing'); expect(mocks.navigate).not.toHaveBeenCalled();
});

it('paginates native results and releases the snapshot on close', async () => {
  mocks.start.mockResolvedValue({ ...snapshot, hasNextPage: true, nextPageCursor: '40' });
  mocks.page.mockResolvedValue({ ...snapshot, rows: [{ ...row, historyId: 'second', title: 'Older CLI work' }] });
  const view = render(<HistoryBrowser initialTab="cli" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load more' })); await screen.findByText('Older CLI work');
  expect(screen.getByText('Saved CLI work')).toBeTruthy(); expect(mocks.page).toHaveBeenCalledWith('snapshot', '40');
  view.unmount(); expect(mocks.release).toHaveBeenCalledWith('snapshot');
});

it('polls provisional snapshots and reports expiry and failed provider coverage', async () => {
  mocks.start.mockResolvedValue({ ...snapshot, status: 'provisional', rows: [] });
  mocks.page.mockResolvedValue({ ...snapshot, coverage: [{ source: 'claude', state: 'failed' }] });
  render(<HistoryBrowser initialTab="cli" />);
  await screen.findByText('Loading saved conversations…'); await screen.findByText('Saved CLI work');
  await screen.findByText('claude history could not be loaded. Try refreshing.');
  mocks.start.mockResolvedValue({ ...snapshot, status: 'expired', rows: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' })); await screen.findByText('History expired. Refresh to try again.');
});

it('labels empty history, unavailable previews and shortened previews', async () => {
  mocks.transcript.mockResolvedValue({ messages: [], truncated: false, unavailableReason: 'Transcript missing' });
  render(<HistoryBrowser initialTab="cli" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Saved CLI work/ }));
  await screen.findByText('Transcript missing'); expect((screen.getByRole('button', { name: 'Resume conversation' }) as HTMLButtonElement).disabled).toBe(true);
  mocks.transcript.mockResolvedValue({ messages: [], truncated: true });
  fireEvent.click(screen.getByRole('button', { name: /^Saved CLI work/ }));
  await screen.findByText(/This preview is shortened/);
  mocks.start.mockResolvedValue({ ...snapshot, rows: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' })); await screen.findByText('No saved conversations match these filters.');
});

it('handles native reader failures and browser-only access honestly', async () => {
  mocks.start.mockRejectedValue(new Error('Reader failed'));
  const view = render(<HistoryBrowser initialTab="cli" />); await screen.findByText('Reader failed');
  view.unmount(); mocks.desktop.mockReturnValue(false);
  render(<HistoryBrowser initialTab="threads" />); fireEvent.click(screen.getByRole('button', { name: 'CLI Agents' }));
  await screen.findByText(/CLI Agent history is available in the desktop app/);
});

it('restores from archived detail and keeps the archive banner on failure', async () => {
  const restored = vi.fn(); mocks.unarchive.mockRejectedValueOnce(new Error('Environment missing'));
  render(<ArchivedThreadBanner threadId="t" onRestored={restored} />);
  fireEvent.click(screen.getByRole('button', { name: 'Restore conversation' })); await screen.findByText('Environment missing'); expect(restored).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Restore conversation' })); await waitFor(() => expect(restored).toHaveBeenCalledOnce());
});

it.each(['threads', 'cli'] as const)('keeps the same preview workflow for %s', async (tab) => {
  const view = render(<HistoryBrowser initialTab={tab} />);
  expect(screen.getByRole('region', { name: 'Saved conversation' }).textContent).toContain('Select a conversation');
  const selectedRow = await screen.findByRole('button', { name: tab === 'threads' ? /^Saved work/ : /^Saved CLI work/ });
  fireEvent.click(selectedRow);
  await screen.findByText(tab === 'threads' ? 'Thread saved answer' : 'Saved answer');
  expect(selectedRow.getAttribute('aria-pressed')).toBe('true');
  expect(mocks.navigate).not.toHaveBeenCalled();
  expect(view.container.ownerDocument.querySelector('.history-workbench > .history-results')).toBeTruthy();
  expect(view.container.ownerDocument.querySelector('.history-workbench > .history-transcript')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
  await waitFor(() => expect(screen.getByRole('region', { name: 'Saved conversation' }).textContent).toContain('Select a conversation'));
});

it.each([null, 2])('opens the original thread only on explicit action (archivedAt=%s)', async (archivedAt) => {
  mocks.history.mockResolvedValue({ rows: [{ ...thread, archivedAt, title: null }] });
  render(<HistoryBrowser initialTab="threads" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Untitled conversation/ }));
  await screen.findByText('Thread saved answer');
  fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
  expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('t'));
  expect(mocks.unarchive).not.toHaveBeenCalled();
});

it('ignores stale thread previews, clears selection on filtering, and allows retry after failure', async () => {
  mocks.history.mockResolvedValue({ rows: [thread, { ...thread, id: 't2', title: 'Second thread' }] });
  let resolve!: (value: unknown) => void;
  mocks.timeline.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  render(<HistoryBrowser initialTab="threads" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Saved work/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Second thread/ }));
  await screen.findByText('Thread saved answer');
  resolve({ rows: [{ kind: 'conversation', role: 'assistant', text: 'Stale answer' }] });
  await waitFor(() => expect(screen.queryByText('Stale answer')).toBeNull());
  mocks.timeline.mockRejectedValueOnce(new Error('Preview failed'));
  fireEvent.click(screen.getByRole('button', { name: /^Second thread/ }));
  await screen.findByText('Preview failed');
  expect(screen.queryByText('Loading transcript…')).toBeNull();
  mocks.timeline.mockResolvedValue({ rows: [], timelinePage: { hasOlderRows: true } });
  fireEvent.click(screen.getByRole('button', { name: /^Second thread/ }));
  await screen.findByText('No text messages were saved in this conversation.');
  await screen.findByText(/This preview is shortened/);
  fireEvent.change(screen.getByLabelText('Thread history status'), { target: { value: 'archived' } });
  expect(screen.getByRole('region', { name: 'Saved conversation' }).textContent).toContain('Select a conversation');
});

it('keeps project and search filters when switching tabs and discards pending previews', async () => {
  let resolve!: (value: unknown) => void;
  mocks.timeline.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  render(<HistoryBrowser initialTab="threads" initialProjectId="p" />);
  fireEvent.change(screen.getByLabelText('Search conversation history'), { target: { value: 'saved' } });
  await waitFor(() => expect(mocks.history).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'saved' })));
  fireEvent.click(await screen.findByRole('button', { name: /^Saved work/ }));
  fireEvent.click(screen.getByRole('button', { name: 'CLI Agents' }));
  await screen.findByRole('button', { name: /^Saved CLI work/ });
  expect(mocks.start).toHaveBeenLastCalledWith({ projectId: 'p', filter: 'project', query: 'saved' });
  resolve({ rows: [{ kind: 'conversation', role: 'assistant', text: 'Late thread answer' }] });
  await waitFor(() => expect(screen.queryByText('Late thread answer')).toBeNull());
  expect(screen.getByRole('region', { name: 'Saved conversation' }).textContent).toContain('Select a conversation');
});

it('ends native loading on preview failure and supports harnesses without a transcript', async () => {
  mocks.transcript.mockRejectedValueOnce(new Error('Transcript reader failed'));
  mocks.start.mockResolvedValue({ ...snapshot, rows: [row, { ...row, historyId: 'no-preview', title: 'No preview', supportsTranscript: false, supportsExactResume: true }] });
  render(<HistoryBrowser initialTab="cli" />);
  fireEvent.click(await screen.findByRole('button', { name: /^Saved CLI work/ }));
  await screen.findByText('Transcript reader failed'); expect(screen.queryByText('Loading transcript…')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^No preview/ }));
  await screen.findByText(/Transcript previews are unavailable/);
  expect(mocks.transcript).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: 'Resume conversation' }) as HTMLButtonElement).disabled).toBe(false);
});
