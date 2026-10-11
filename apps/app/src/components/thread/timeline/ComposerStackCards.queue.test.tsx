// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueuedMessagesCard } from './ComposerStackCards.js';

const api = vi.hoisted(() => ({
  nextTurn: vi.fn(), sendNextTurn: vi.fn(), flushNextTurn: vi.fn(),
  deleteNextTurn: vi.fn(), onUpdated: vi.fn(), unsubscribe: vi.fn(),
  holdNextTurnForEdit: vi.fn(), releaseNextTurnEditHold: vi.fn(), updateNextTurn: vi.fn()
}));
const surface = vi.hoisted(() => ({ hasDesktopBridge: vi.fn() }));
const toast = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock('../../../lib/product-client.js', () => ({ product: { threads: api } }));
vi.mock('../../../store.js', () => ({ useUi: { getState: () => toast } }));
vi.mock('../../../lib/app-surface.js', () => surface);
vi.mock('../../../lib/in-app-browser-link-preference.js', () => ({ handleHttpLinkClick: vi.fn() }));
vi.mock('../secondary-panel/threadSecondaryPanelLogic.js', () => ({ loadWorkspaceMeta: vi.fn() }));

let items: Array<{ id: string; text: string; status: string; failureReason?: string; updatedAt?: number }>;
let paused: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  surface.hasDesktopBridge.mockReturnValue(true);
  items = [
    { id: 'one', text: 'First queued message', status: 'queued', updatedAt: 1_000 },
    { id: 'two', text: 'Second queued message', status: 'queued', updatedAt: 2_000 }
  ];
  paused = false;
  api.nextTurn.mockImplementation(async () => ({ items: [...items], paused }));
  api.onUpdated.mockReturnValue(api.unsubscribe);
  api.sendNextTurn.mockImplementation(async (_threadId, id) => {
    items = items.filter((row) => row.id !== id);
    return { ok: true };
  });
  api.deleteNextTurn.mockImplementation(async (_threadId, id) => {
    items = items.filter((row) => row.id !== id);
    return { ok: true };
  });
  api.holdNextTurnForEdit.mockResolvedValue({ ok: true, leaseMs: 120_000, heldUntil: Date.now() + 120_000 });
  api.releaseNextTurnEditHold.mockResolvedValue({ ok: true });
  api.updateNextTurn.mockImplementation(async (_threadId, id, input: { text: string }) => {
    const row = items.find((candidate) => candidate.id === id)!;
    row.text = input.text;
    row.updatedAt = (row.updatedAt ?? 0) + 1;
    return { ok: true, item: { id, text: row.text, updatedAt: row.updatedAt } };
  });
});
afterEach(cleanup);

it.each([false, true])('keeps phone Send now available for queued and failed messages (paused=%s)', async (isPaused) => {
  surface.hasDesktopBridge.mockReturnValue(false);
  paused = isPaused;
  items[1]!.status = 'failed';
  render(<QueuedMessagesCard threadId="thread-1" />);
  const sends = await screen.findAllByRole('button', { name: 'Send now' });
  for (const button of sends) {
    expect((button as HTMLButtonElement).disabled).toBe(false);
  }
  fireEvent.click(sends[1]!);
  await waitFor(() => expect(api.sendNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'two'));
  await waitFor(() => expect(screen.queryByText('Second queued message')).toBeNull());
  expect(screen.getByText('First queued message')).toBeTruthy();
  expect(screen.queryByText(/requires the desktop app/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send all' }) !== null).toBe(isPaused);
});

it.each([false, true])('shows a send action on every message (paused=%s) and sends only the clicked row', async (isPaused) => {
  paused = isPaused;
  const { unmount } = render(<QueuedMessagesCard threadId="thread-1" />);
  const sends = await screen.findAllByRole('button', { name: 'Send now' });
  expect(sends).toHaveLength(2);
  expect((sends[0] as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText('Send now requires the desktop app; browser approval is unavailable.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Send all' }) !== null).toBe(isPaused);
  fireEvent.click(sends[1]!);
  await waitFor(() => expect(screen.queryByText('Second queued message')).toBeNull());
  expect(api.sendNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'two');
  expect(api.flushNextTurn).not.toHaveBeenCalled();
  expect(screen.getByText('First queued message')).toBeTruthy();
  expect(paused).toBe(isPaused);
  unmount();
  expect(api.unsubscribe).toHaveBeenCalledOnce();
});

it('keeps all queue actions from racing with a send and marks the selected button busy', async () => {
  let resolve!: () => void;
  api.sendNextTurn.mockImplementation(() => new Promise<void>((done) => { resolve = done; }));
  render(<QueuedMessagesCard threadId="thread-1" />);
  const sends = await screen.findAllByRole('button', { name: 'Send now' });
  fireEvent.click(sends[0]!);
  expect(sends[0]!.getAttribute('aria-busy')).toBe('true');
  for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(sends[0]!);
  fireEvent.click(sends[1]!);
  expect(api.sendNextTurn).toHaveBeenCalledOnce();
  items = items.slice(1);
  await act(async () => resolve());
  expect((screen.getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false);
});

it.each([new Error('Host daemon is not connected'), 'unexpected'])('keeps failed sends visible and permits retry (%s)', async (error) => {
  api.sendNextTurn.mockRejectedValueOnce(error);
  render(<QueuedMessagesCard threadId="thread-1" />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Send now' }))[0]!);
  expect((await screen.findByRole('alert')).textContent).toBe(
    error instanceof Error ? error.message : 'Failed to send queued message'
  );
  expect(screen.getByText('First queued message')).toBeTruthy();
  await waitFor(() => expect((screen.getAllByRole('button', { name: 'Send now' })[0] as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getAllByRole('button', { name: 'Send now' })[0]!);
  await waitFor(() => expect(screen.queryByText('First queued message')).toBeNull());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('disables in-flight rows but allows explicitly retrying failed rows', async () => {
  items[0]!.status = 'dispatching';
  items[1]!.status = 'failed';
  items[1]!.failureReason = 'Previous failure';
  render(<QueuedMessagesCard threadId="thread-1" />);
  const sends = await screen.findAllByRole('button', { name: 'Send now' });
  expect((sends[0] as HTMLButtonElement).disabled).toBe(true);
  expect((sends[1] as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByText('Previous failure')).toBeTruthy();
  fireEvent.click(sends[1]!);
  await waitFor(() => expect(api.sendNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'two'));
});

it('retains the separate paused-queue Send all action', async () => {
  paused = true;
  api.flushNextTurn.mockImplementation(async () => { items = []; });
  render(<QueuedMessagesCard threadId="thread-1" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Send all' }));
  await waitFor(() => expect(screen.queryByTestId('thread-queued-messages')).toBeNull());
  expect(api.flushNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', true);
  expect(api.sendNextTurn).not.toHaveBeenCalled();
});

it.each(['flush', 'delete'] as const)('blocks sending while a queue %s is pending, then restores actions', async operation => {
  paused = true;
  let resolve!: () => void;
  const pending = () => new Promise<void>(done => { resolve = done; });
  if (operation === 'flush') api.flushNextTurn.mockImplementation(pending);
  else api.deleteNextTurn.mockImplementation(pending);
  render(<QueuedMessagesCard threadId="thread-1" />);
  await screen.findByText('First queued message');
  if (operation === 'flush') fireEvent.click(screen.getByRole('button', { name: 'Send all' }));
  else fireEvent.click(within(screen.getByText('First queued message').closest('li')!)
    .getByRole('button', { name: 'Remove queued message' }));
  for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
  for (const send of screen.getAllByRole('button', { name: 'Send now' })) fireEvent.click(send);
  expect(api.sendNextTurn).not.toHaveBeenCalled();
  items = operation === 'flush' ? [] : items.slice(1);
  await act(async () => resolve());
  if (operation === 'flush') expect(screen.queryByTestId('thread-queued-messages')).toBeNull();
  else expect((screen.getByRole('button', { name: 'Send now' }) as HTMLButtonElement).disabled).toBe(false);
});

it('still removes a selected row independently', async () => {
  render(<QueuedMessagesCard threadId="thread-1" />);
  const first = (await screen.findByText('First queued message')).closest('li')!;
  fireEvent.click(within(first).getByRole('button', { name: 'Remove queued message' }));
  await waitFor(() => expect(screen.queryByText('First queued message')).toBeNull());
  expect(api.deleteNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'one');
  expect(screen.getByText('Second queued message')).toBeTruthy();
});

const httpError = (status: number, message = `http ${status}`, code?: string) => Object.assign(new Error(message), { status, code });
const rowOf = (text: string) => screen.getByText(text).closest('li')!;
async function openEditor(text = 'First queued message') {
  const row = (await screen.findByText(text)).closest('li')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Edit queued message' }));
  return await screen.findByRole('textbox', { name: 'Queued message text' }) as HTMLTextAreaElement;
}

it('offers editing only for messages that are still waiting to be sent', async () => {
  items[0]!.status = 'dispatching';
  items[1]!.status = 'failed';
  items.push({ id: 'three', text: 'Third queued message', status: 'queued', updatedAt: 3_000 });
  render(<QueuedMessagesCard threadId="thread-1" />);
  await screen.findByText('Third queued message');
  expect(screen.getAllByRole('button', { name: 'Edit queued message' })).toHaveLength(1);
  expect(within(rowOf('Third queued message')).getByRole('button', { name: 'Edit queued message' })).toBeTruthy();
});

it('holds the message while it is edited and swaps the row actions for save and cancel', async () => {
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  expect(editor.value).toBe('First queued message');
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledExactlyOnceWith('thread-1', 'one'));
  const row = editor.closest('li')!;
  expect(within(row).queryByRole('button', { name: 'Send now' })).toBeNull();
  expect(within(row).queryByRole('button', { name: 'Remove queued message' })).toBeNull();
  expect(within(row).getByRole('button', { name: 'Save' })).toBeTruthy();
  expect(within(row).getByRole('button', { name: 'Cancel' })).toBeTruthy();
  // One editor at a time; the other message keeps its own actions.
  expect(within(rowOf('Second queued message')).getByRole('button', { name: 'Send now' })).toBeTruthy();
  expect((within(rowOf('Second queued message')).getByRole('button', { name: 'Edit queued message' }) as HTMLButtonElement).disabled).toBe(true);
});

it('saves the edited text against the revision it opened, then shows the saved text without releasing', async () => {
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'Edited message' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(api.updateNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'one', { text: 'Edited message', expectedUpdatedAt: 1_000 });
  expect(screen.getByText('Edited message')).toBeTruthy();
  expect(screen.queryByText('First queued message')).toBeNull();
  // The save already ended the hold on the server.
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
  expect(toast.pushToast).not.toHaveBeenCalled();
});

it('cancels without saving, restores the original text and releases the hold', async () => {
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'Discarded' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.getByText('First queued message')).toBeTruthy();
  expect(api.updateNextTurn).not.toHaveBeenCalled();
  await waitFor(() => expect(api.releaseNextTurnEditHold).toHaveBeenCalledExactlyOnceWith('thread-1', 'one'));
});

it('cancels on Escape and saves on Ctrl+Enter', async () => {
  render(<QueuedMessagesCard threadId="thread-1" />);
  let editor = await openEditor();
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(screen.queryByRole('textbox')).toBeNull();
  await waitFor(() => expect(api.releaseNextTurnEditHold).toHaveBeenCalledOnce());

  editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'Keyboard save' } });
  fireEvent.keyDown(editor, { key: 'Enter' });
  expect(api.updateNextTurn).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true });
  await waitFor(() => expect(api.updateNextTurn).toHaveBeenCalledExactlyOnceWith('thread-1', 'one', { text: 'Keyboard save', expectedUpdatedAt: 1_000 }));
});

it('releases the hold when the card unmounts mid-edit', async () => {
  const { unmount } = render(<QueuedMessagesCard threadId="thread-1" />);
  await openEditor();
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledOnce());
  unmount();
  await waitFor(() => expect(api.releaseNextTurnEditHold).toHaveBeenCalledExactlyOnceWith('thread-1', 'one'));
});

it('closes the editor with a toast when the server says the message was already claimed', async () => {
  api.holdNextTurnForEdit.mockRejectedValue(httpError(409));
  render(<QueuedMessagesCard threadId="thread-1" />);
  await openEditor();
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(toast.pushToast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('already being sent'), 'error');
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
});

it.each([404, 409])('closes the editor with a toast and refreshes when saving answers %s', async (status) => {
  api.updateNextTurn.mockRejectedValue(httpError(status));
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'Too late' } });
  const loads = api.nextTurn.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(toast.pushToast).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/queued message/), 'error');
  await waitFor(() => expect(api.nextTurn.mock.calls.length).toBeGreaterThan(loads));
  expect(screen.getByText('First queued message')).toBeTruthy();
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
});

it('confirms the save against the revision the editor opened, not one a later refresh brought in', async () => {
  let notify!: (payload: unknown) => void;
  api.onUpdated.mockImplementation((listener: (payload: unknown) => void) => { notify = listener; return api.unsubscribe; });
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'Mine' } });
  items[0] = { ...items[0]!, text: 'Theirs', updatedAt: 1_500 };
  const loads = api.nextTurn.mock.calls.length;
  act(() => notify({ id: 'thread-1' }));
  await waitFor(() => expect(api.nextTurn.mock.calls.length).toBeGreaterThan(loads));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(api.updateNextTurn).toHaveBeenCalledOnce());
  expect(api.updateNextTurn).toHaveBeenCalledWith('thread-1', 'one', { text: 'Mine', expectedUpdatedAt: 1_000 });
});

it('keeps the editor, the draft and the hold when the message changed elsewhere, and replaces it on a second save', async () => {
  api.updateNextTurn.mockImplementationOnce(async () => {
    items[0] = { ...items[0]!, text: 'Theirs', updatedAt: 1_500 };
    throw httpError(409, 'Queued message changed; reopen it to edit the latest text', 'queued-send-changed');
  });
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledOnce());
  fireEvent.change(editor, { target: { value: 'Mine' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toMatch(/changed elsewhere/);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Mine');
  // The hold is renewed straight away rather than released.
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2));
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
  expect(toast.pushToast).not.toHaveBeenCalled();

  await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(api.updateNextTurn).toHaveBeenLastCalledWith('thread-1', 'one', { text: 'Mine', expectedUpdatedAt: 1_500 });
  expect(screen.getByText('Mine')).toBeTruthy();
});

it('waits for an in-flight renewal before saving, so the renewal cannot hold the row after the save', async () => {
  let grant!: (value: unknown) => void;
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledOnce());
  // The editor's first hold has settled; make the next one hang as if a renewal were in flight.
  api.holdNextTurnForEdit.mockImplementation(() => new Promise((done) => { grant = done; }));
  api.updateNextTurn.mockRejectedValueOnce(httpError(500, 'offline'));
  fireEvent.change(editor, { target: { value: 'Edited' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  // The failed save resumes the hold, which is now the request that hangs.
  await screen.findByRole('alert');
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => { await Promise.resolve(); });
  expect(api.updateNextTurn).toHaveBeenCalledOnce();
  await act(async () => grant({ ok: true, leaseMs: 120_000, heldUntil: 0 }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(api.updateNextTurn).toHaveBeenCalledTimes(2);
  expect(api.holdNextTurnForEdit).toHaveBeenCalledTimes(2);
});

it('does not save when the hold learns the message was claimed while the save waited for it', async () => {
  let fail!: (error: unknown) => void;
  api.holdNextTurnForEdit.mockImplementation(() => new Promise((_done, reject) => { fail = reject; }));
  render(<QueuedMessagesCard threadId="thread-1" />);
  await openEditor();
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await act(async () => fail(httpError(409)));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(api.updateNextTurn).not.toHaveBeenCalled();
  expect(toast.pushToast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('already being sent'), 'error');
});

it('keeps the editor and the draft open when saving fails for another reason, then lets the user retry', async () => {
  api.updateNextTurn.mockRejectedValueOnce(httpError(400, 'Queued message cannot be empty')).mockRejectedValueOnce('unexpected');
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Queued message cannot be empty');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Failed to save queued message'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Second try' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(screen.getByText('Second try')).toBeTruthy();
  expect(toast.pushToast).not.toHaveBeenCalled();
});

it('blocks double saves and cancelling while a save is in flight', async () => {
  let resolve!: (value: unknown) => void;
  api.updateNextTurn.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<QueuedMessagesCard threadId="thread-1" />);
  await openEditor();
  const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  fireEvent.click(save);
  expect(save.disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(api.updateNextTurn).toHaveBeenCalledOnce());
  fireEvent.click(save);
  expect(api.updateNextTurn).toHaveBeenCalledOnce();
  items[0]!.text = 'Saved elsewhere';
  await act(async () => resolve({ ok: true, item: { id: 'one', text: 'Saved elsewhere', updatedAt: 1_001 } }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(screen.getByText('Saved elsewhere')).toBeTruthy();
});

it('keeps the draft through a queue refresh while editing', async () => {
  let notify!: (payload: unknown) => void;
  api.onUpdated.mockImplementation((listener: (payload: unknown) => void) => { notify = listener; return api.unsubscribe; });
  render(<QueuedMessagesCard threadId="thread-1" />);
  const editor = await openEditor();
  fireEvent.change(editor, { target: { value: 'Half-typed' } });
  const loads = api.nextTurn.mock.calls.length;
  act(() => notify({ id: 'thread-1' }));
  await waitFor(() => expect(api.nextTurn.mock.calls.length).toBeGreaterThan(loads));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Half-typed');
});

it.each([
  ['sent', () => { items = items.filter((row) => row.id !== 'one'); }],
  ['claimed for sending', () => { items[0]!.status = 'dispatching'; }]
])('closes the editor with a notice when the message is %s before the edit is saved', async (_label, change) => {
  let notify!: (payload: unknown) => void;
  api.onUpdated.mockImplementation((listener: (payload: unknown) => void) => { notify = listener; return api.unsubscribe; });
  render(<QueuedMessagesCard threadId="thread-1" />);
  await openEditor();
  change();
  act(() => notify({ id: 'thread-1' }));
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  expect(toast.pushToast).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('sent'), 'info');
  expect(api.releaseNextTurnEditHold).not.toHaveBeenCalled();
  expect(api.updateNextTurn).not.toHaveBeenCalled();
});

it('drops an open editor when the card moves to another thread, releasing the old hold', async () => {
  const { rerender } = render(<QueuedMessagesCard threadId="thread-1" />);
  await openEditor();
  await waitFor(() => expect(api.holdNextTurnForEdit).toHaveBeenCalledOnce());
  rerender(<QueuedMessagesCard threadId="thread-2" />);
  await waitFor(() => expect(api.releaseNextTurnEditHold).toHaveBeenCalledExactlyOnceWith('thread-1', 'one'));
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(api.holdNextTurnForEdit).toHaveBeenCalledOnce();
  expect(toast.pushToast).not.toHaveBeenCalled();
});
