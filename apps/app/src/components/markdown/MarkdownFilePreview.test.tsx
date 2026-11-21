// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MarkdownFilePreview } from './MarkdownFilePreview.js';
import { rememberMarkdownDraft } from './markdown-drafts.js';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('../../lib/product-client.js', () => ({ product: { threads: { readMarkdown: mocks.read, writeMarkdown: mocks.write } } }));
vi.mock('./MarkdownDocument.js', () => ({ default: ({ value, savedValue, onChange, onSave, saving, readOnlyReason }: any) => <>
  <textarea aria-label="Draft" value={value} onChange={event => onChange?.(event.target.value)} readOnly={!!readOnlyReason} />
  <div>{readOnlyReason}</div><output>{savedValue}</output>
  <button type="button" disabled={!onSave || saving || !!readOnlyReason} onClick={onSave}>Save</button>
</> }));
const props = { content: '# Initial', path: '/repo/doc.md', threadId: 't1', projectId: 'p1' };
const read = (content = '# Initial', sha256 = 'a'.repeat(64)) => ({ ok: true, content, sha256 });
beforeEach(() => { mocks.read.mockResolvedValue(read()); mocks.write.mockResolvedValue({ ok: true, sha256: 'b'.repeat(64) }); });
afterEach(() => {
  cleanup(); vi.resetAllMocks();
  rememberMarkdownDraft(JSON.stringify(['thread-markdown', 't1', 'p1', false, '/repo/doc.md']), { content: '', draft: '' });
});
const draft = () => screen.getByLabelText('Draft') as HTMLTextAreaElement;
async function ready() { await waitFor(() => expect(draft().readOnly).toBe(false)); }

it('reads and saves through the same thread and project, keeping keystrokes during a save', async () => {
  let resolve!: (result: unknown) => void;
  mocks.write.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  render(<MarkdownFilePreview {...props} />); await ready();
  expect(mocks.read).toHaveBeenCalledWith('t1', '/repo/doc.md', 'p1');
  fireEvent.change(draft(), { target: { value: 'first' } }); fireEvent.click(screen.getByText('Save'));
  fireEvent.change(draft(), { target: { value: 'new typing' } });
  await act(async () => { resolve({ ok: true, sha256: 'b'.repeat(64) }); });
  expect(draft().value).toBe('new typing'); expect(screen.getByText('first')).toBeTruthy();
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(mocks.write).toHaveBeenLastCalledWith('t1', { path: '/repo/doc.md', projectId: 'p1', content: 'new typing', expectedSha256: 'b'.repeat(64) }));
});
it('keeps a failed draft, reviews latest source and requires an explicit revision decision', async () => {
  mocks.write.mockResolvedValueOnce({ ok: false, message: 'Changed on machine' });
  render(<MarkdownFilePreview {...props} />); await ready();
  fireEvent.change(draft(), { target: { value: 'my draft' } });
  mocks.read.mockResolvedValue(read('Agent update', 'c'.repeat(64)));
  fireEvent.click(screen.getByText('Save'));
  await screen.findByLabelText('Markdown save conflict');
  expect(draft().value).toBe('my draft'); expect(screen.getByLabelText('Latest saved version').textContent).toBe('Agent update');
  fireEvent.change(draft(), { target: { value: 'Agent update + mine' } });
  fireEvent.click(screen.getByText('Use reviewed revision for next save'));
  fireEvent.click(screen.getByText('Save'));
  await waitFor(() => expect(mocks.write).toHaveBeenLastCalledWith('t1', expect.objectContaining({ expectedSha256: 'c'.repeat(64), content: 'Agent update + mine' })));
});
it('retains drafts across remounts and notices a newer external revision', async () => {
  const view = render(<MarkdownFilePreview {...props} />); await ready();
  fireEvent.change(draft(), { target: { value: 'kept' } }); view.unmount();
  mocks.read.mockResolvedValue(read('New external', 'c'.repeat(64)));
  render(<MarkdownFilePreview {...props} />);
  await screen.findByLabelText('Markdown save conflict'); expect(draft().value).toBe('kept');
});
it('discards a draft only after confirmation and never saves while reviewing', async () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const view = render(<MarkdownFilePreview {...props} />); await ready();
  fireEvent.change(draft(), { target: { value: 'mine' } });
  mocks.read.mockResolvedValue(read('Agent', 'c'.repeat(64)));
  view.rerender(<MarkdownFilePreview {...props} revision={1} />); await screen.findByLabelText('Markdown save conflict');
  expect((screen.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Discard draft and use latest')); expect(draft().value).toBe('mine');
  confirm.mockReturnValue(true); fireEvent.click(screen.getByText('Discard draft and use latest')); expect(draft().value).toBe('Agent');
  expect(mocks.write).not.toHaveBeenCalled(); confirm.mockRestore();
});
it('reloads a clean document and keeps an offline draft through a failed refresh and write', async () => {
  const view = render(<MarkdownFilePreview {...props} />); await ready();
  mocks.read.mockResolvedValue(read('Updated', 'c'.repeat(64)));
  view.rerender(<MarkdownFilePreview {...props} revision={1} />); await waitFor(() => expect(draft().value).toBe('Updated'));
  fireEvent.change(draft(), { target: { value: 'Offline draft' } });
  mocks.read.mockRejectedValue(new Error('offline'));
  view.rerender(<MarkdownFilePreview {...props} revision={2} />); await screen.findByRole('alert');
  mocks.write.mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getByText('Save')); await screen.findByText(/Save failed. Your draft has been kept/);
  expect(draft().value).toBe('Offline draft');
  fireEvent.click(screen.getByText('Review latest version')); await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(4));
});
it('shows an initial failed capability read without granting writes', async () => {
  mocks.read.mockResolvedValue({ ok: false, message: 'Outside the checkout' });
  render(<MarkdownFilePreview {...props} />); await screen.findByText(/Outside the checkout/); expect(draft().readOnly).toBe(true);
});
it('keeps storage and previews without a thread read-only and refreshes their contents', async () => {
  const view = render(<MarkdownFilePreview {...props} storage />); await screen.findByText('Thread storage is read only in this viewer.');
  view.rerender(<MarkdownFilePreview {...props} storage content="Updated storage" />); expect(draft().value).toBe('Updated storage');
  view.unmount(); render(<MarkdownFilePreview {...props} threadId={undefined} />); await screen.findByText('This preview has no writable checkout.');
  expect(mocks.read).not.toHaveBeenCalled();
});
it('ignores a capability read and a write acknowledgement after unmount', async () => {
  let resolveRead!: (result: unknown) => void;
  mocks.read.mockImplementationOnce(() => new Promise(done => { resolveRead = done; }));
  const view = render(<MarkdownFilePreview {...props} />); view.unmount();
  await act(async () => { resolveRead(read('stale')); });
  let resolveWrite!: (result: unknown) => void;
  mocks.write.mockImplementationOnce(() => new Promise(done => { resolveWrite = done; }));
  const second = render(<MarkdownFilePreview {...props} />); await ready();
  fireEvent.change(draft(), { target: { value: 'mine' } }); fireEvent.click(screen.getByText('Save')); second.unmount();
  await act(async () => { resolveWrite({ ok: true, sha256: 'b'.repeat(64) }); });
});
