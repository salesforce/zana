// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const state = vi.hoisted(() => ({
  compact: true, selected: 'one', saved: false, kept: false, missing: false,
  entries: [] as InboxEntry[],
  readFile: vi.fn(), readDataUrl: vi.fn(), resolveDoc: vi.fn(), copy: vi.fn(), openIn: vi.fn(), save: vi.fn(), keep: vi.fn(), remove: vi.fn(), exportPdf: vi.fn(), select: vi.fn(), markRead: vi.fn()
}));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => state.compact }));
vi.mock('../store.js', () => ({
  useInbox: (pick: (s: unknown) => unknown) => pick({ entries: state.entries, loading: false }),
  useInboxSelection: (pick: (s: unknown) => unknown) => pick({ selectedEntryId: state.selected, select: state.select }),
  useInboxRead: (pick: (s: unknown) => unknown) => pick({ markRead: state.markRead }),
  useData: (pick: (s: unknown) => unknown) => pick({ projects: state.missing ? [] : [{ id: 'p', name: 'My project', path: '/project' }], terminals: {}, structuredQuestionsEnabled: false, restoreTerminal: vi.fn(), createTerminal: vi.fn() }),
  useUi: (pick: (s: unknown) => unknown) => pick({ setNav: vi.fn(), selectTab: vi.fn(), pushToast: vi.fn() }),
  useInboxKeep: (pick: (s: unknown) => unknown) => pick({ keptIds: state.kept ? { one: true } : {} }),
  useSavedMark: (pick: (s: unknown) => unknown) => pick({ savedEntryIds: state.saved ? { one: true } : {} }),
  useInboxAnswered: (pick: (s: unknown) => unknown) => pick({ answeredIds: {} }),
  useInboxHostActions: (pick: (s: unknown) => unknown) => pick({ byEntryId: {}, resolutionByEntryId: { [state.selected]: { loading: false, error: false, resolved: true } } }),
  useSuggestions: (pick: (s: unknown) => unknown) => pick({ entries: [] }),
  deleteInboxEntry: (id: string) => state.remove(id),
  toggleInboxKeep: (id: string) => state.keep(id),
  saveInboxEntry: (...args: unknown[]) => state.save(...args),
  replyToInboxEntry: vi.fn(), resolveInboxHostAction: vi.fn(), refreshInboxHostActions: vi.fn(), runInboxHostAction: vi.fn()
}));
vi.mock('../lib/product-client.js', () => ({ product: {
  fs: { readFile: (...args: unknown[]) => state.readFile(...args), readDataUrl: (...args: unknown[]) => state.readDataUrl(...args), resolveDoc: (...args: unknown[]) => state.resolveDoc(...args) },
  clipboard: { writeText: (...args: unknown[]) => state.copy(...args) },
  openers: { openIn: (...args: unknown[]) => state.openIn(...args) },
  inbox: { exportPdf: (...args: unknown[]) => state.exportPdf(...args) }
} }));
vi.mock('./AgentLauncher.js', () => ({ AgentLauncher: ({ initialPrompt }: { initialPrompt: string }) => <div data-testid="launcher">{initialPrompt}</div> }));
vi.mock('./InboxQuestionBlock.js', () => ({ QuestionBlock: () => <div>Question</div> }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <p>{text}</p>, DocContent: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock('../lib/renderReportHtml.js', () => ({ renderReportHtml: vi.fn(async () => '<p>Report</p>') }));
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => 'actionable' }));
import { InboxDetail } from './InboxDetail.js';
import { fileManagerName } from '../lib/file-manager.js';

beforeEach(() => {
  vi.clearAllMocks();
  state.compact = true; state.selected = 'one'; state.saved = false; state.kept = false; state.missing = false;
  state.entries = [{ id: 'one', ts: Date.now(), projectId: 'p', subject: 'A mobile report', comments: 'The useful summary.', docs: [{ path: '.zcc/library/report.md' }] }];
  state.readFile.mockResolvedValue({ ok: true, content: 'Full document content' });
  state.readDataUrl.mockReset().mockResolvedValue({ ok: true, dataUrl: 'data:image/png;base64,cGl4ZWxz' });
  state.resolveDoc.mockResolvedValue({ ok: false });
  state.copy.mockResolvedValue({ ok: true });
  state.openIn.mockResolvedValue({ ok: true });
  state.save.mockResolvedValue(undefined);
  state.exportPdf.mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const view = (visible = true) => <MemoryRouter><section className="inbox-view"><InboxDetail visible={visible} /></section></MemoryRouter>;
const actions = () => fireEvent.click(screen.getByRole('button', { name: 'Message actions', exact: true }));

it.each([true, false])('renders image attachments without the text reader (compact=%s)', async (compact) => {
  state.compact = compact;
  state.entries[0]!.docs = [{ path: 'screenshots/preview #1.PNG' }];
  render(view());
  if (compact) {
    expect(state.readDataUrl).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'preview #1.PNG', exact: true }));
  }
  const image = await screen.findByRole('img', { name: 'screenshots/preview #1.PNG' });
  expect(image.getAttribute('src')).toBe('data:image/png;base64,cGl4ZWxz');
  expect(state.readDataUrl).toHaveBeenCalledWith('/project/screenshots/preview #1.PNG');
  expect(state.readFile).not.toHaveBeenCalled();
  expect(state.resolveDoc).not.toHaveBeenCalled();
});

it('re-reads relocated images with the image reader and copies the resolved path', async () => {
  state.compact = false;
  state.entries[0]!.docs = [{ path: 'preview.png' }];
  state.readDataUrl.mockImplementation(async (path: string) => path === '/project/preview.png'
    ? { ok: false, message: 'Missing' }
    : { ok: true, dataUrl: 'data:image/png;base64,cGl4ZWxz' });
  state.resolveDoc.mockResolvedValue({ ok: true, rel: 'screenshots/preview.png', relocated: true });
  render(view());
  await screen.findByRole('img', { name: 'screenshots/preview.png' });
  expect(state.readDataUrl).toHaveBeenLastCalledWith('/project/screenshots/preview.png');
  expect(screen.getByText('relocated')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy path to screenshots/preview.png' }));
  await waitFor(() => expect(state.copy).toHaveBeenCalledWith('/project/screenshots/preview.png'));
  expect(state.readFile).not.toHaveBeenCalled();
});

it('surfaces failed image reads and does not reuse an old image after selection changes', async () => {
  state.compact = false;
  state.entries[0]!.docs = [{ path: 'good.png' }, { path: 'missing.png' }];
  render(view());
  await screen.findByRole('img', { name: 'good.png' });
  state.readDataUrl.mockResolvedValue({ ok: false, message: 'Image not found' });
  fireEvent.click(screen.getByRole('option', { name: 'missing.png' }));
  await screen.findByText('Image not found');
  expect(screen.queryByRole('img')).toBeNull();
});

it('ignores an image read completing after a different document is selected', async () => {
  state.compact = false;
  state.entries[0]!.docs = [{ path: 'slow.png' }, { path: 'report.md' }];
  let finish!: (result: unknown) => void;
  state.readDataUrl.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(view());
  await waitFor(() => expect(state.readDataUrl).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('option', { name: 'report.md' }));
  await screen.findByText('Full document content');
  finish({ ok: true, dataUrl: 'data:image/png;base64,cGl4ZWxz' });
  await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
});

it('requires confirmation before deletion or advancing and marking the next message read', () => {
  state.compact = false;
  state.entries.push({ id: 'two', ts: Date.now() - 1, projectId: 'p', comments: 'Keep me too' });
  render(view());
  const button = screen.getByRole('button', { name: 'Delete this inbox entry' });
  vi.mocked(window.confirm).mockReturnValue(false);
  fireEvent.click(button);
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.select).not.toHaveBeenCalled();
  expect(state.markRead).not.toHaveBeenCalled();
  vi.mocked(window.confirm).mockReturnValue(true);
  button.focus();
  fireEvent.keyDown(button, { key: 'Delete' });
  expect(state.remove).toHaveBeenCalledExactlyOnceWith('one');
  expect(state.select).toHaveBeenCalledWith('two');
  expect(state.markRead).toHaveBeenCalledWith('two');
});

it('ignores Backspace, held Delete, editors and popup buttons without even asking to delete', () => {
  state.compact = false;
  const { container } = render(view());
  const button = screen.getByRole('button', { name: 'Delete this inbox entry' });
  button.focus();
  fireEvent.keyDown(button, { key: 'Backspace' });
  fireEvent.keyDown(button, { key: 'Delete', repeat: true });
  const scope = container.querySelector('.inbox-view')!;
  for (const markup of ['<div contenteditable="true"><span>Draft</span></div>', '<div role="dialog" aria-modal="true"><button>Options</button></div>']) {
    scope.insertAdjacentHTML('beforeend', markup);
    const popup = scope.lastElementChild!;
    fireEvent.keyDown(popup.firstElementChild!, { key: 'Delete' });
    fireEvent.keyDown(popup.firstElementChild!, { key: 'Backspace' });
    popup.remove();
  }
  expect(window.confirm).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});

it('does not register a delete shortcut while hidden, unselected or after unmount', () => {
  state.compact = false;
  const { rerender, unmount } = render(view(false));
  const button = screen.getByRole('button', { name: 'Delete this inbox entry' });
  fireEvent.keyDown(button, { key: 'Delete' });
  state.selected = '';
  rerender(view());
  fireEvent.keyDown(document.querySelector('.inbox-view')!, { key: 'Delete' });
  unmount();
  fireEvent.keyDown(window, { key: 'Delete' });
  expect(window.confirm).not.toHaveBeenCalled();
  expect(state.remove).not.toHaveBeenCalled();
});

it('keeps reading chrome compact and loads documents only when opened', async () => {
  render(view());
  expect(screen.getByText('My project')).toBeTruthy();
  expect(screen.queryByLabelText('Download this inbox entry as PDF')).toBeNull();
  expect(state.readFile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'report.md', exact: true }));
  await screen.findByText('Full document content');
  expect(state.readFile).toHaveBeenCalledWith('/project/.zcc/library/report.md');
  expect(screen.queryByRole('button', { name: /in (Finder|Explorer|file manager)|in Cursor|in VS Code/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy path to .zcc/library/report.md' }));
  await waitFor(() => expect(state.copy).toHaveBeenCalledWith('/project/.zcc/library/report.md'));
});

it('routes labeled actions to the existing keep, save, export, launch and delete handlers', async () => {
  render(view());
  actions(); fireEvent.click(screen.getByRole('button', { name: 'Keep this entry' }));
  expect(state.keep).toHaveBeenCalledWith('one');
  actions(); fireEvent.click(screen.getByRole('button', { name: 'Save for later' }));
  await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ sourceEntryId: 'one' }), 'one'));
  actions(); fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
  await waitFor(() => expect(state.exportPdf).toHaveBeenCalled());
  actions(); fireEvent.click(screen.getByRole('button', { name: 'New agent from this message' }));
  expect(screen.getByTestId('launcher').textContent).toContain('The useful summary.');
  actions(); fireEvent.click(screen.getByRole('button', { name: 'Delete message' }));
  expect(state.remove).toHaveBeenCalledWith('one');
});

it('keeps saved/kept state and project availability honest in the action sheet', () => {
  state.saved = true; state.kept = true; state.missing = true;
  render(view());
  actions();
  expect(screen.getByRole('button', { name: 'Saved for later' }).hasAttribute('disabled')).toBe(true);
  expect(screen.getByRole('button', { name: 'Remove keep flag' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.queryByRole('button', { name: 'New agent from this message' })).toBeNull();
});

it('does not offer export/save for an empty entry, and shows failed document reads without desktop openers', async () => {
  state.entries[0] = { ...state.entries[0]!, comments: '', docs: [] };
  const { rerender } = render(view());
  actions();
  expect(screen.queryByRole('button', { name: 'Save for later' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
  state.selected = 'two';
  state.entries = [{ ...state.entries[0]!, id: 'two', docs: [{ path: 'missing.md' }] }];
  state.readFile.mockResolvedValue({ ok: false, message: 'Document missing' });
  rerender(view());
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'missing.md' }));
  await screen.findByText('Document missing');
  expect(screen.queryByRole('button', { name: 'Reveal project folder' })).toBeNull();
});

it('keeps desktop actions and file preview behavior, and resets reply drafts for a different entry', async () => {
  const { rerender } = render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Leave a reply' }));
  expect(document.activeElement).toBe(screen.getByRole('textbox'));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Draft for the first message' } });
  state.selected = 'two';
  state.entries.push({ ...state.entries[0]!, id: 'two' });
  rerender(view());
  expect(screen.queryByRole('textbox')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Leave a reply' }));
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
  state.compact = false;
  rerender(view());
  expect(screen.queryByRole('button', { name: 'Message actions' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Download this inbox entry as PDF' })).toBeTruthy();
  await screen.findByText('Full document content');
  expect(screen.getByRole('button', { name: new RegExp(`in ${fileManagerName()}`) })).toBeTruthy();
});

it.each([true, false])('streams resolved video attachments without reading binary content (compact=%s)', async (compact) => {
  state.compact = compact;
  state.entries[0]!.docs = [{ path: 'demo #1.mp4' }];
  state.resolveDoc.mockResolvedValue({ ok: true, rel: 'docs/demo #1.mp4', relocated: true });
  render(view());
  if (compact) fireEvent.click(screen.getByRole('button', { name: 'demo #1.mp4', exact: true }));
  const video = await screen.findByLabelText('Video preview: demo #1.mp4') as HTMLVideoElement;
  expect(state.readFile).not.toHaveBeenCalled();
  expect(state.resolveDoc).toHaveBeenCalledWith('/project', 'demo #1.mp4', undefined);
  expect(video.getAttribute('src')).toBe('/api/v1/file-preview/video?path=%2Fproject%2Fdocs%2Fdemo+%231.mp4&source=workspace');
  expect(video.hasAttribute('controls') && video.hasAttribute('playsinline')).toBe(true);
  expect(screen.getByText('relocated')).toBeTruthy();
  fireEvent.error(video);
  expect(screen.getByRole('status').textContent).toContain('Could not play this video');
  fireEvent.loadedMetadata(video);
  expect(screen.queryByText(/Could not play this video/)).toBeNull();
});

it.each(['missing', 'error', 'unknown'])('shows video resolution failures: %s', async (failure) => {
  state.entries[0]!.docs = [{ path: 'missing.mp4' }];
  if (failure === 'error') state.resolveDoc.mockRejectedValue(new Error('Host offline'));
  if (failure === 'unknown') state.resolveDoc.mockRejectedValue(null);
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'missing.mp4', exact: true }));
  await screen.findByText(failure === 'missing' ? 'Video file not found' : failure === 'error' ? 'Host offline' : 'Video preview unavailable');
  expect(screen.queryByLabelText(/Video preview:/)).toBeNull();
  expect(state.readFile).not.toHaveBeenCalled();
});

it('ignores video resolution after the attachment is collapsed', async () => {
  state.entries[0]!.docs = [{ path: 'slow.mp4' }];
  let resolve!: (value: unknown) => void;
  state.resolveDoc.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(view());
  const toggle = screen.getByRole('button', { name: 'slow.mp4', exact: true });
  fireEvent.click(toggle);
  await waitFor(() => expect(state.resolveDoc).toHaveBeenCalled());
  fireEvent.click(toggle);
  resolve({ ok: true, rel: 'slow.mp4' });
  await waitFor(() => expect(screen.queryByLabelText(/Video preview:/)).toBeNull());
});

it('streams an exact video path over HTTP without needing a desktop resolver', async () => {
  state.entries[0]!.docs = [{ path: 'exact.mp4' }];
  vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'exact.mp4', exact: true }));
  await screen.findByLabelText('Video preview: exact.mp4');
  expect(fetch).toHaveBeenCalledWith('/api/v1/file-preview/video?path=%2Fproject%2Fexact.mp4&source=workspace', expect.objectContaining({ method: 'HEAD' }));
  expect(state.resolveDoc).not.toHaveBeenCalled();
  expect(state.readFile).not.toHaveBeenCalled();
});
