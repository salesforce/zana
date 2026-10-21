// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const project = vi.hoisted(() => ({ id: 'p', name: 'My project', path: '/project' }));
const state = vi.hoisted(() => ({
  compact: false, structured: false, action: null as unknown, selected: 'one', saved: false, kept: false, missing: false,
  entries: [] as InboxEntry[],
  readFile: vi.fn(), readDataUrl: vi.fn(), resolveDoc: vi.fn(), copy: vi.fn(), openIn: vi.fn(), save: vi.fn(), keep: vi.fn(), remove: vi.fn(), exportPdf: vi.fn(), select: vi.fn(), markRead: vi.fn()
}));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => state.compact }));
vi.mock('../store.js', () => ({
  useInbox: (pick: (s: unknown) => unknown) => pick({ entries: state.entries, loading: false }),
  useInboxSelection: (pick: (s: unknown) => unknown) => pick({ selectedEntryId: state.selected, select: state.select }),
  useInboxRead: (pick: (s: unknown) => unknown) => pick({ markRead: state.markRead }),
  useData: (pick: (s: unknown) => unknown) => pick({ projects: state.missing ? [] : [project], terminals: {}, structuredQuestionsEnabled: state.structured, restoreTerminal: vi.fn(), createTerminal: vi.fn() }),
  useUi: (pick: (s: unknown) => unknown) => pick({ setNav: vi.fn(), selectTab: vi.fn(), pushToast: vi.fn() }),
  useInboxKeep: (pick: (s: unknown) => unknown) => pick({ keptIds: state.kept ? { one: true } : {} }),
  useSavedMark: (pick: (s: unknown) => unknown) => pick({ savedEntryIds: state.saved ? { one: true } : {} }),
  useInboxAnswered: (pick: (s: unknown) => unknown) => pick({ answeredIds: {} }),
  useInboxHostActions: (pick: (s: unknown) => unknown) => pick({ byEntryId: state.action ? { one: state.action } : {}, resolutionByEntryId: { one: { loading: false, error: false, resolved: true } } }),
  useSuggestions: (pick: (s: unknown) => unknown) => pick({ entries: [{ id: 's1', projectId: 'p', dedupeKey: 'dk', title: 'Next', status: 'pending' }] }),
  deleteInboxEntry: (id: string) => state.remove(id),
  toggleInboxKeep: (id: string) => state.keep(id),
  saveInboxEntry: (...args: unknown[]) => state.save(...args),
  replyToInboxEntry: vi.fn(),
  resolveInboxHostAction: vi.fn(async () => {}),
  runInboxHostAction: vi.fn(async () => {})
}));
vi.mock('../lib/product-client.js', () => ({ product: {
  fs: { readFile: (...args: unknown[]) => state.readFile(...args), readDataUrl: (...args: unknown[]) => state.readDataUrl(...args), resolveDoc: (...args: unknown[]) => state.resolveDoc(...args) },
  clipboard: { writeText: (...args: unknown[]) => state.copy(...args) },
  openers: { openIn: (...args: unknown[]) => state.openIn(...args) },
  inbox: { exportPdf: (...args: unknown[]) => state.exportPdf(...args) }
} }));
vi.mock('./AgentLauncher.js', () => ({ AgentLauncher: ({ initialPrompt }: { initialPrompt: string }) => <div data-testid="launcher">{initialPrompt}</div> }));
vi.mock('./InboxQuestionBlock.js', () => ({ QuestionBlock: () => <div data-testid="question">Question</div> }));
vi.mock('./MarkdownContent.js', () => ({ MarkdownContent: ({ text }: { text: string }) => <p>{text}</p>, DocContent: ({ content }: { content: string }) => <p>{content}</p> }));
vi.mock('../lib/renderReportHtml.js', () => ({ renderReportHtml: vi.fn(async () => '<p>Report</p>') }));
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => 'actionable' }));
import { InboxDetail } from './InboxDetail.js';
import { inboxThreadCache } from '../hooks/useInboxThread.js';

const view = () => <MemoryRouter><section className="inbox-view"><InboxDetail visible /></section></MemoryRouter>;
const ready = async () => { render(view()); await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const root = () => document.querySelector('.inbox-detail') as HTMLElement;
const kids = () => Array.from(root().children).filter((c) => !c.hasAttribute('data-testid') || c.getAttribute('data-testid') !== 'launcher');

describe('InboxDetail pinned reply bar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inboxThreadCache.clear();
    state.structured = false; state.action = null; state.missing = false; state.selected = 'one';
    state.entries = [{ id: 'one', ts: 1, projectId: 'p', dedupeKey: 'dk', subject: 'Report', comments: 'Body', docs: [{ path: 'report.md' }] }];
    state.readFile.mockResolvedValue({ ok: true, content: 'Doc' });
    state.resolveDoc.mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('renders the dock last, after comments, docs and related next steps', async () => {
    await ready();
    const children = kids();
    const dock = root().querySelector('.inbox-detail-dock')!;
    expect(children.at(-1)).toBe(dock);
    const index = (sel: string) => children.indexOf(root().querySelector(sel)!);
    expect(index('.inbox-detail-comments')).toBeGreaterThan(-1);
    expect(index('.inbox-detail-docs')).toBeGreaterThan(index('.inbox-detail-comments'));
    const related = index('.inbox-related');
    expect(related).toBeGreaterThan(index('.inbox-detail-docs'));
    expect(related).toBeLessThan(children.indexOf(dock));
    expect(index('.inbox-detail-docs')).toBeLessThan(children.indexOf(dock));
  });

  it('keeps a question with options above the comments and out of the dock', async () => {
    state.structured = true;
    state.entries = [{ id: 'one', ts: 1, projectId: 'p', dedupeKey: 'dk', subject: 'Q', comments: 'Body', question: { options: [{ id: 'a', label: 'A' }] } } as InboxEntry];
    await ready();
    const dock = root().querySelector('.inbox-detail-dock')!;
    const question = screen.getByTestId('question');
    expect(dock.contains(question)).toBe(false);
    expect(root().querySelector('.inbox-detail-comments')).toBeNull();
    expect(kids().at(-1)).toBe(dock);
    expect(question.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps a host action surface above the pinned dock', async () => {
    state.action = { entryId: 'one', kind: 'squad-proposal', status: 'pending' };
    state.entries = [{ id: 'one', ts: 1, projectId: 'p', dedupeKey: 'dk', subject: 'Squad', comments: 'Ready', squadProposal: { proposalId: 'p1' } } as InboxEntry];
    await ready();
    const dock = root().querySelector('.inbox-detail-dock')!;
    expect(kids().at(-1)).toBe(dock);
    expect(dock.querySelector('.inbox-reply-input')).toBeNull();
  });

  describe('reply textarea', () => {
    const setup = async () => {
      vi.stubGlobal('innerHeight', 500);
      let height = 40;
      Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => height });
      await ready();
      fireEvent.click(screen.getByLabelText('Leave a reply'));
      const input = screen.getByLabelText('Reply to the originating agent') as HTMLTextAreaElement;
      const type = (value: string, h: number) => { height = h; fireEvent.change(input, { target: { value } }); };
      return { input, type };
    };
    afterEach(() => { delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight; });

    it('grows with the text, shrinks on delete and caps at 40% of the window', async () => {
      const { input, type } = await setup();
      expect(input.style.height).toBe('72px');
      type('a\nb\nc', 120);
      expect(input.style.height).toBe('120px');
      expect(input.style.overflowY).toBe('hidden');
      type('a', 30);
      expect(input.style.height).toBe('72px');
      type('x'.repeat(500), 900);
      expect(input.style.height).toBe('200px');
      expect(input.style.overflowY).toBe('auto');
    });
  });
});
