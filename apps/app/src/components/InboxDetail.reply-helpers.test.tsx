// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const project = vi.hoisted(() => ({ id: 'p', name: 'My project', path: '/project' }));
const state = vi.hoisted(() => ({
  compact: false, structured: false, action: null as unknown, selected: 'one', answered: {} as Record<string, boolean>, blocker: 'actionable', terminals: {} as Record<string, unknown[]>, reply: vi.fn(), reopenAnswer: vi.fn(), saved: false, kept: false, missing: false,
  entries: [] as InboxEntry[],
  readFile: vi.fn(), readDataUrl: vi.fn(), resolveDoc: vi.fn(), copy: vi.fn(), openIn: vi.fn(), save: vi.fn(), keep: vi.fn(), remove: vi.fn(), exportPdf: vi.fn(), select: vi.fn(), markRead: vi.fn()
}));
vi.mock('../hooks/useCompactLayout.js', () => ({ useCompactLayout: () => state.compact }));
vi.mock('../store.js', () => ({
  useInbox: (pick: (s: unknown) => unknown) => pick({ entries: state.entries, loading: false }),
  useInboxSelection: (pick: (s: unknown) => unknown) => pick({ selectedEntryId: state.selected, select: state.select }),
  useInboxRead: (pick: (s: unknown) => unknown) => pick({ markRead: state.markRead }),
  useData: (pick: (s: unknown) => unknown) => pick({ projects: state.missing ? [] : [project], terminals: state.terminals, structuredQuestionsEnabled: state.structured, restoreTerminal: vi.fn(), createTerminal: vi.fn() }),
  useUi: (pick: (s: unknown) => unknown) => pick({ setNav: vi.fn(), selectTab: vi.fn(), pushToast: vi.fn() }),
  useInboxKeep: (pick: (s: unknown) => unknown) => pick({ keptIds: state.kept ? { one: true } : {} }),
  useSavedMark: (pick: (s: unknown) => unknown) => pick({ savedEntryIds: state.saved ? { one: true } : {} }),
  useInboxAnswered: (pick: (s: unknown) => unknown) => pick({ answeredIds: state.answered }),
  useInboxHostActions: (pick: (s: unknown) => unknown) => pick({ byEntryId: state.action ? { one: state.action } : {}, resolutionByEntryId: { one: { loading: false, error: false, resolved: true }, two: { loading: false, error: false, resolved: true } } }),
  useSuggestions: (pick: (s: unknown) => unknown) => pick({ entries: [{ id: 's1', projectId: 'p', dedupeKey: 'dk', title: 'Next', status: 'pending' }] }),
  deleteInboxEntry: (id: string) => state.remove(id),
  toggleInboxKeep: (id: string) => state.keep(id),
  saveInboxEntry: (...args: unknown[]) => state.save(...args),
  replyToInboxEntry: (...args: unknown[]) => state.reply(...args),
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
vi.mock('../lib/executionInboxBlockerState.js', () => ({ useExecutionInboxBlockerState: () => state.blocker }));
import { InboxDetail } from './InboxDetail.js';
import { composeSeqFor, useInboxReplyDrafts } from '../stores/inbox-reply-drafts.js';


const view = () => <MemoryRouter><section className="inbox-view"><div className="inbox-view-detail"><InboxDetail visible /></div></section></MemoryRouter>;
const ready = async () => { const r = render(view()); await act(async () => { await new Promise((res) => setTimeout(res, 0)); }); return r; };
const input = () => screen.getByLabelText('Reply to the originating agent') as HTMLTextAreaElement;
const live = () => { state.terminals = { p: [{ id: 'sess', title: 'Agent', status: 'running' }] }; };
const press = (key: string, init: KeyboardEventInit = {}, target: Element = document.querySelector('.inbox-view-detail')!) =>
  fireEvent.keyDown(target, { key, bubbles: true, ...init });
const entry = (id: string, extra: Partial<InboxEntry> = {}): InboxEntry => ({ id, ts: 1, projectId: 'p', dedupeKey: id, sessionId: 'sess', subject: id, comments: 'Body', ...extra } as InboxEntry);

describe('InboxDetail reply helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInboxReplyDrafts.setState({ drafts: {}, order: [], composeRequest: null });
    state.structured = false; state.action = null; state.missing = false; state.selected = 'one'; state.terminals = {}; state.answered = {}; state.blocker = 'actionable';
    state.reply.mockResolvedValue(true);
    state.entries = [entry('one'), entry('two')];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    window.confirm = vi.fn(() => true);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('keeps a draft when switching to another entry and back', async () => {
    live();
    const { rerender } = await ready();
    fireEvent.change(input(), { target: { value: 'half typed' } });
    state.selected = 'two';
    rerender(view());
    expect(input().value).toBe('');
    state.selected = 'one';
    rerender(view());
    expect(input().value).toBe('half typed');
  });

  it('clears the draft after a successful send and keeps it after a failed one', async () => {
    live();
    await ready();
    fireEvent.change(input(), { target: { value: 'answer' } });
    state.reply.mockResolvedValueOnce(false);
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter', metaKey: true }); });
    expect(input().value).toBe('answer');
    expect(useInboxReplyDrafts.getState().drafts.one).toBe('answer');
    await act(async () => { fireEvent.keyDown(input(), { key: 'Enter', metaKey: true }); });
    expect(state.reply).toHaveBeenCalledTimes(2);
    expect(input().value).toBe('');
    expect(useInboxReplyDrafts.getState().drafts.one).toBeUndefined();
  });

  it('clears the draft when the entry is deleted', async () => {
    live();
    await ready();
    useInboxReplyDrafts.getState().setDraft('one', 'unsent');
    await act(async () => { press('Delete'); });
    expect(state.remove).toHaveBeenCalledWith('one');
    expect(useInboxReplyDrafts.getState().drafts.one).toBeUndefined();
  });

  describe('R shortcut', () => {
    it('focuses the textarea for a live reply, caret at the end', async () => {
      live();
      useInboxReplyDrafts.getState().setDraft('one', 'abc');
      await ready();
      press('r');
      expect(document.activeElement).toBe(input());
      expect(input().selectionStart).toBe(3);
    });

    it('expands the reopen shell and focuses the new box', async () => {
      state.entries = [entry('one', { sessionId: undefined })];
      await ready();
      expect(screen.getByRole('button', { name: 'Leave a reply' }).getAttribute('aria-keyshortcuts')).toBe('R');
      press('R');
      expect(document.activeElement).toBe(input());
    });

    it('reopens a collapsed "Replied to" box', async () => {
      live();
      state.answered = { one: true };
      await ready();
      expect(screen.getByText('Replied to')).toBeTruthy();
      press('r');
      expect(document.activeElement).toBe(input());
    });

    it.each([
      ['typing in another input', () => { const o = document.createElement('input'); document.querySelector('.inbox-view')!.append(o); o.focus(); return { target: o, init: {} }; }],
      ['with the command key', () => ({ target: document.querySelector('.inbox-view-detail')!, init: { metaKey: true } })],
      ['inside a modal', () => { const m = document.createElement('div'); m.className = 'modal-backdrop'; document.body.append(m); return { target: document.querySelector('.inbox-view-detail')!, init: {} }; }]
    ])('does nothing %s', async (_name, arrange) => {
      live();
      await ready();
      const { target, init } = arrange();
      press('r', init, target);
      expect(document.activeElement).not.toBe(input());
      document.querySelectorAll('.modal-backdrop').forEach((n) => n.remove());
    });

    it('does nothing for question, host action and Squad proposal entries', async () => {
      live();
      state.structured = true;
      state.entries = [entry('one', { question: { options: [{ id: 'a', label: 'A' }] } } as Partial<InboxEntry>)];
      const q = await ready();
      press('r');
      expect(useInboxReplyDrafts.getState().composeRequest).toBeNull();
      q.unmount();
      state.structured = false;
      state.entries = [entry('one', { squadProposal: { proposalId: 'p1' } } as Partial<InboxEntry>)];
      state.action = { entryId: 'one', kind: 'squad-proposal', status: 'pending' };
      await ready();
      press('r');
      expect(useInboxReplyDrafts.getState().composeRequest).toBeNull();
    });
  });

  it('Esc blurs the textarea, focuses the scroller and keeps the draft', async () => {
    live();
    await ready();
    input().focus();
    fireEvent.change(input(), { target: { value: 'keep me' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    const scroller = document.querySelector('.inbox-view-detail') as HTMLElement;
    expect(scroller.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(scroller);
    expect(useInboxReplyDrafts.getState().drafts.one).toBe('keep me');
  });

  it('shows a kept draft in reopen mode after switching entries, without taking focus', async () => {
    state.entries = [entry('one', { sessionId: undefined }), entry('two', { sessionId: undefined })];
    const { rerender } = await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Leave a reply' }));
    fireEvent.change(input(), { target: { value: 'kept' } });
    state.selected = 'two';
    rerender(view());
    expect(screen.getByRole('button', { name: 'Leave a reply' })).toBeTruthy();
    state.selected = 'one';
    rerender(view());
    expect(input().value).toBe('kept');
    expect(document.activeElement).not.toBe(input());
  });

  it('has no R target or quote button on a Squad result notice', async () => {
    state.entries = [entry('one', { sessionId: undefined, executionId: 'exec', squadNotice: 'proposal-result' } as Partial<InboxEntry>)];
    await ready();
    expect(screen.queryByLabelText('Reply to the originating agent')).toBeNull();
    press('r');
    expect(useInboxReplyDrafts.getState().composeRequest).toBeNull();
    expect(document.querySelector('.inbox-quote-selection')).toBeNull();
  });

  it('keeps a leading space or newline typed into an empty box', async () => {
    live();
    await ready();
    fireEvent.change(input(), { target: { value: ' ' } });
    expect(input().value).toBe(' ');
    fireEvent.change(input(), { target: { value: ' x' } });
    expect(useInboxReplyDrafts.getState().drafts.one).toBe(' x');
  });

  it('overflows once the content exceeds the stylesheet cap that is lower than 40%', async () => {
    live();
    vi.stubGlobal('innerHeight', 800);
    const original = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element, pseudo?: string | null) => {
      const style = original(el, pseudo);
      return el instanceof HTMLTextAreaElement ? ({ ...style, maxHeight: '180px' } as CSSStyleDeclaration) : style;
    });
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => 250 });
    try {
      await ready();
      fireEvent.change(input(), { target: { value: 'tall' } });
      expect(input().style.height).toBe('180px');
      expect(input().style.overflowY).toBe('auto');
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('re-measures a long draft when the window is resized, and stops listening on unmount', async () => {
    live();
    vi.stubGlobal('innerHeight', 1000);
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => 450 });
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    try {
      const { unmount } = await ready();
      fireEvent.change(input(), { target: { value: 'tall' } });
      expect(input().style.height).toBe('400px');
      expect(input().style.overflowY).toBe('auto');
      vi.stubGlobal('innerHeight', 2000);
      act(() => { window.dispatchEvent(new Event('resize')); });
      expect(input().style.height).toBe('450px');
      expect(input().style.overflowY).toBe('hidden');
      const handler = add.mock.calls.find((c) => c[0] === 'resize')![1];
      unmount();
      expect(remove).toHaveBeenCalledWith('resize', handler);
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it('sizes the textarea when it mounts after a collapsed "Replied to" box reopens with an unchanged draft', async () => {
    live();
    state.answered = { one: true };
    vi.stubGlobal('innerHeight', 1000);
    useInboxReplyDrafts.getState().setDraft('one', 'a long\nkept\ndraft');
    Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => 300 });
    try {
      await ready();
      expect(screen.getByText('Replied to')).toBeTruthy();
      press('r');
      expect(input().style.height).toBe('300px');
    } finally {
      delete (HTMLTextAreaElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
  });

  it.each(['resolved', 'queued'])('offers neither R nor Quote in reply on a collapsed execution-linked box (%s)', async (blocker) => {
    live();
    state.entries = [entry('one', { executionId: 'exec', blockerId: 'b' } as Partial<InboxEntry>)];
    state.blocker = blocker;
    await ready();
    press('r');
    expect(useInboxReplyDrafts.getState().composeRequest).toBeNull();
    expect(document.querySelector('.inbox-quote-selection')).toBeNull();
  });

  it('still offers R on an execution-linked box whose blocker is actionable', async () => {
    live();
    state.entries = [entry('one', { executionId: 'exec', blockerId: 'b' } as Partial<InboxEntry>)];
    await ready();
    press('r');
    expect(document.activeElement).toBe(input());
  });

  it('restores the scroller tabindex on unmount', async () => {
    live();
    const { unmount } = await ready();
    const scroller = document.querySelector('.inbox-view-detail')!;
    expect(scroller.getAttribute('tabindex')).toBe('-1');
    unmount();
    expect(scroller.hasAttribute('tabindex')).toBe(false);
  });

  it('does not arm focus for a compose request on a collapsed execution-linked box', async () => {
    live();
    state.entries = [entry('one', { executionId: 'exec', blockerId: 'b' } as Partial<InboxEntry>)];
    state.blocker = 'resolved';
    await ready();
    act(() => { useInboxReplyDrafts.getState().requestCompose('one'); });
    expect(composeSeqFor('one')(useInboxReplyDrafts.getState())).toBe(1);
    state.blocker = 'actionable';
    document.body.focus();
    cleanup();
    await ready();
    expect(document.activeElement).not.toBe(input());
  });
});
