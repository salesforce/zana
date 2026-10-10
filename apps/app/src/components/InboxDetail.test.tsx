// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { InboxEntry } from '@zana-ai/zcc-domain/product';

const project = vi.hoisted(() => ({ id: 'p', name: 'My project', path: '/project' }));
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
  useData: (pick: (s: unknown) => unknown) => pick({ projects: state.missing ? [] : [project], terminals: {}, structuredQuestionsEnabled: false, restoreTerminal: vi.fn(), createTerminal: vi.fn() }),
  useUi: (pick: (s: unknown) => unknown) => pick({ setNav: vi.fn(), selectTab: vi.fn(), pushToast: vi.fn() }),
  useInboxKeep: (pick: (s: unknown) => unknown) => pick({ keptIds: state.kept ? { one: true } : {} }),
  useSavedMark: (pick: (s: unknown) => unknown) => pick({ savedEntryIds: state.saved ? { one: true } : {} }),
  useInboxAnswered: (pick: (s: unknown) => unknown) => pick({ answeredIds: {} }),
  useSuggestions: (pick: (s: unknown) => unknown) => pick({ entries: [] }),
  deleteInboxEntry: (id: string) => state.remove(id),
  toggleInboxKeep: (id: string) => state.keep(id),
  saveInboxEntry: (...args: unknown[]) => state.save(...args),
  replyToInboxEntry: vi.fn()
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
import { InboxDetail, inboxDocCache } from './InboxDetail.js';
import { inboxThreadCache } from '../hooks/useInboxThread.js';

describe('InboxDetail attention layout', () => {
  const source = readFileSync(`${process.cwd()}/apps/app/src/components/InboxDetail.tsx`, 'utf8');

  it('puts the answer surface above comments/docs when the entry is a question', () => {
    const early = source.indexOf('{questionFirst ? answerSurface : null}');
    const comments = source.indexOf('inbox-detail-comments');
    const late = source.indexOf('{questionFirst ? null : answerSurface}');
    const footer = source.indexOf('inbox-detail-footer');
    const related = source.indexOf('<RelatedNextSteps');
    expect(early).toBeGreaterThan(-1);
    expect(comments).toBeGreaterThan(early);
    expect(footer).toBeGreaterThan(comments);
    expect(late).toBeGreaterThan(footer);
    expect(related).toBeGreaterThan(late);
  });

  it('returns to the landing as Inbox, not Overview, and drops the debug project id', () => {
    expect(source).toContain('<span>Inbox</span>');
    expect(source).toContain('title="Back to inbox"');
    expect(source).not.toContain('<span>Overview</span>');
    expect(source).not.toContain('inbox-detail-meta-id');
    expect(source).not.toContain('InboxGuidance');
  });

  it('opens the agent inspector after spawn without leaving the inbox', () => {
    expect(source).toContain(
      'onLaunched={(session, projectId) => inspectAgentSession(session.id, projectId, navigate)}'
    );
  });

  it('uses a status pill and compact reopen labels instead of repeating the title', () => {
    expect(source).toContain('inbox-status-pill--ended');
    expect(source).toContain('inbox-status-pill--live');
    expect(source).toContain('inbox-status-pill--gone');
    expect(source).toContain("'Reopen'");
    expect(source).toContain("'Resume'");
    expect(source).toContain("'Open'");
    expect(source).not.toContain('· session ended');
    expect(source).not.toContain('Reopen in a new agent <span');
    expect(source).not.toContain('Reply / pick this back up');
    expect(source).toContain('Leave a reply…');
    expect(source).toContain('inbox-reply-composer');
  });
});

describe('InboxDetail revisit cache', () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.useFakeTimers();
    inboxDocCache.clear(); inboxThreadCache.clear();
    state.compact = false; state.selected = 'one'; state.missing = false;
    state.entries = [{ id: 'one', ts: 1, projectId: 'p', subject: 'Report', docs: [{ path: 'report.md' }] }];
    state.readFile.mockResolvedValue({ ok: true, content: 'Full document content' });
    state.resolveDoc.mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  const view = () => <MemoryRouter><section className="inbox-view"><InboxDetail visible /></section></MemoryRouter>;

  it('delays the document skeleton on a miss and paints the cache on a remount without one', async () => {
    let finish!: (value: unknown) => void;
    state.readFile.mockReturnValueOnce(new Promise((r) => { finish = r; }));
    const first = render(view());
    expect(screen.queryByRole('status', { name: 'Loading document' })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.getByRole('status', { name: 'Loading document' })).toBeTruthy();
    finish({ ok: true, content: 'Full document content' });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Full document content')).toBeTruthy();
    first.unmount();
    state.readFile.mockReturnValueOnce(new Promise(() => {}));
    render(view());
    expect(screen.getByText('Full document content')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(screen.queryByRole('status', { name: 'Loading document' })).toBeNull();
  });

  it('never caches a failure; a failed revalidation keeps this view but evicts the copy', async () => {
    state.readFile.mockResolvedValueOnce({ ok: false, message: 'Missing' });
    const first = render(view());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(inboxDocCache.get('one:report.md')).toBeUndefined();
    first.unmount();
    state.readFile.mockResolvedValueOnce({ ok: true, content: 'Good' });
    const second = render(view());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Good')).toBeTruthy();
    second.unmount();
    state.readFile.mockResolvedValueOnce({ ok: false, message: 'Gone' });
    const third = render(view());
    // A possibly transient failure keeps the copy this view painted, but evicts it.
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Good')).toBeTruthy();
    expect(inboxDocCache.get('one:report.md')).toBeUndefined();
    third.unmount();
    // The next visit re-reads and shows the real state.
    state.readFile.mockResolvedValueOnce({ ok: false, message: 'Gone' });
    render(view());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.queryByText('Good')).toBeNull();
  });
});
