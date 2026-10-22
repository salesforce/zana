/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentDocSnapshot } from '../../lib/agent-doc-contract.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const navigate = { toProject: vi.fn(), openInWindow: vi.fn() };
const rpc = vi.fn();
let realtime: ((payload: unknown) => void) | null = null;
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({
  callPluginRpc: (...args: unknown[]) => rpc(...args),
  useRealtime: (_channel: string, handler: (payload: unknown) => void) => { realtime = handler; },
  useZccContext: () => ({ projectId: 'proj-1', threadId: 'thr-1' }),
  useZccNavigate: () => navigate
}));

const docApi = { doc: null as AgentDocSnapshot | null, loading: false, error: null as string | null, leased: false, heldBy: null, resolve: vi.fn(), update: vi.fn(), saved: vi.fn(), takeOver: vi.fn(), propose: vi.fn(), reload: vi.fn() };
vi.mock('./agent-doc/useAgentScriptDoc.js', () => ({ useAgentScriptDoc: () => docApi }));
const previewMounts = vi.fn();
vi.mock('./AgentforcePreviewPanel.js', () => ({
  AgentforcePreviewPanel: (props: { params: unknown; pinnedPath?: string }) => { previewMounts(); return createElement('div', { 'data-testid': 'preview-stub', 'data-pinned': props.pinnedPath ?? '' }, JSON.stringify(props.params)); }
}));
vi.mock('./ActionCodePreview.js', () => ({
  ActionCodePreview: (props: { content: string; line?: number }) => createElement('div', { 'data-testid': 'code-stub', 'data-line': props.line ?? '' }, props.content)
}));
vi.mock('./AgentScriptGraphPanel.js', () => ({
  AgentScriptGraphPanel: (props: { source: string; focusNode: string | null; onOpenAction(id: string): void }) =>
    createElement('button', { 'data-testid': 'graph-stub', onClick: () => props.onOpenAction('a') }, `${props.source}|${props.focusNode}`)
}));
vi.mock('./AgentActionPanel.js', () => ({
  AgentActionExplorer: (props: { actions: Array<{ id: string; name: string }>; onOpen(a: unknown): void }) =>
    createElement('div', null, props.actions.map(a => createElement('button', { key: a.id, onClick: () => props.onOpen(a) }, `act:${a.name}`))),
  AgentActionPanel: (props: { action: { name: string }; onReveal(line: number): void }) =>
    createElement('button', { 'data-testid': 'action-panel', onClick: () => props.onReveal(9) }, `panel:${props.action.name}`)
}));
let suites: unknown[] = [];
vi.mock('./studio/useSuites.js', () => ({ useSuites: () => suites }));
const orgResult = vi.fn();
vi.mock('./org-rpc.js', () => ({ fetchConnectedOrg: (...args: unknown[]) => orgResult(...args) }));
const openInStudioWindow = vi.fn();
const queue = vi.fn();
vi.mock('./studio-window-route.js', () => ({ STUDIO_TAB_ID: 'salesforce', openInStudioWindow: (...args: unknown[]) => openInStudioWindow(...args) }));
vi.mock('./agent-script-open.js', () => ({ queueAgentScriptOpen: (...args: unknown[]) => queue(...args) }));

import { AgentThreadPanel, diffRows, parseAgentThreadParams } from './AgentThreadPanel.js';

const PATH = 'force-app/bots/QC.agent';
const baseDoc = (over: Partial<AgentDocSnapshot> = {}): AgentDocSnapshot => ({
  projectId: 'proj-1', path: PATH, rev: 1, text: 'a\nb\nc', baseSha256: 'x'.repeat(64), savedText: null, dirty: false,
  diagnostics: [], lease: null, proposals: [], updatedAt: 1, ...over
});
const proposal = (id: string, status: 'pending' | 'accept-requested' | 'accepted' = 'pending') => ({
  id, status, createdAt: 1, input: { path: PATH, expectedSha256: 'x'.repeat(64), content: 'a\nB\nc', summary: `sum ${id}` }
});

describe('AgentThreadPanel', () => {
  const roots: Array<() => void> = [];
  let host: HTMLElement;
  const flush = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
  const mount = async (params: unknown, tabId?: string) => {
    host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(() => { act(() => root.unmount()); host.remove(); });
    await act(async () => { root.render(createElement(AgentThreadPanel, { pluginId: 'salesforce', params, tabId })); });
    await flush();
    return {
      rerender: async (next: unknown) => { await act(async () => { root.render(createElement(AgentThreadPanel, { pluginId: 'salesforce', params: next, tabId })); }); await flush(); },
      unmount: () => { act(() => root.unmount()); }
    };
  };
  const q = (sel: string) => host.querySelector(sel) as HTMLElement | null;
  const click = async (el: Element | null) => { await act(async () => { (el as HTMLElement).click(); }); await flush(); };
  const tab = (name: string) => [...host.querySelectorAll('[role="tab"]')].find(el => el.textContent === name)!;

  beforeEach(() => {
    sessionStorage.clear();
    docApi.doc = baseDoc(); docApi.loading = false; docApi.error = null;
    docApi.resolve.mockReset().mockResolvedValue({ ok: true });
    rpc.mockReset().mockImplementation(async (_p: string, method: string) => {
      if (method === 'agentScript.parse') return { ok: true, result: { actions: [{ id: 'x1', name: 'Lookup', owner: 'topic.t', target: 'apex://L', line: 4, description: '', inputs: [], outputs: [], uses: [] }] } };
      if (method === 'studio.comments.list') return { ok: true, comments: [{ id: 'c1', path: PATH, line: 3, endLine: 3, quote: 'q', body: 'Please fix', author: { kind: 'user', name: 'me' }, createdAt: 1 }] };
      return { ok: false };
    });
    orgResult.mockReset().mockResolvedValue({ ok: true, org: { alias: 'dev', kind: 'sandbox' } });
    openInStudioWindow.mockReset().mockResolvedValue(false);
    navigate.toProject.mockClear(); queue.mockClear(); previewMounts.mockClear();
    suites = [];
  });
  afterEach(() => { for (const stop of roots.splice(0)) stop(); });

  describe('parseAgentThreadParams', () => {
    it('validates path, view and numbers', () => {
      expect(parseAgentThreadParams(undefined)).toBeNull();
      expect(parseAgentThreadParams([])).toBeNull();
      expect(parseAgentThreadParams({})).toBeNull();
      expect(parseAgentThreadParams({ path: 'a.txt' })).toBeNull();
      expect(parseAgentThreadParams({ path: '../x/a.agent' })).toBeNull();
      expect(parseAgentThreadParams({ path: 'x'.repeat(600) + '.agent' })).toBeNull();
      expect(parseAgentThreadParams({ path: PATH })).toEqual({ path: PATH, view: 'file' });
      expect(parseAgentThreadParams({ path: PATH, view: 'bogus' })?.view).toBe('file');
      expect(parseAgentThreadParams({ path: PATH, view: 'graph', line: '12', runId: 'r', turn: '2', node: 'n', projectId: 'p' }))
        .toEqual({ path: PATH, view: 'graph', line: 12, runId: 'r', turn: 2, node: 'n', projectId: 'p' });
      expect(parseAgentThreadParams({ path: PATH, line: 0, turn: 'x' })).toEqual({ path: PATH, view: 'file' });
      expect(parseAgentThreadParams({ path: PATH, line: 4 })?.line).toBe(4);
    });
    it('diffRows collapses unchanged runs', () => {
      const same = Array.from({ length: 10 }, (_, i) => ({ type: 'same' as const, text: `l${i}` }));
      const rows = diffRows([...same, { type: 'add', text: 'n' }, ...same]);
      expect(rows.filter(r => r === null)).toHaveLength(2);
      expect(rows.length).toBe(1 + 2 + 2 + 2);
    });
  });

  it('shows a clear empty state for a missing or invalid path', async () => {
    await mount({ path: 'nope.txt' });
    expect(q('[data-testid="atp-empty"]')?.textContent).toContain('needs an Agent Script path');
    expect(q('[role="tablist"]')).toBeNull();
  });

  it('renders header, org pill and the file view read-only', async () => {
    docApi.doc = baseDoc();
    await mount({ path: PATH, line: '2' });
    expect(q('.sf-atp-name')?.textContent).toBe('QC');
    expect(q('.sf-atp-path')?.textContent).toBe(PATH);
    expect(q('[data-testid="atp-org"]')?.textContent).toBe('dev (sandbox)');
    expect(q('[data-testid="code-stub"]')?.textContent).toBe('a\nb\nc');
    expect(q('[data-testid="code-stub"]')?.getAttribute('data-line')).toBe('2');
    expect(tab('File').getAttribute('aria-selected')).toBe('true');
  });

  it('hides the org pill when no org resolves', async () => {
    orgResult.mockResolvedValue({ ok: false, error: 'no' });
    await mount({ path: PATH });
    expect(q('[data-testid="atp-org"]')).toBeNull();
    orgResult.mockRejectedValue(new Error('boom'));
    await mount({ path: PATH });
  });

  it('shows loading, error and too-large file states', async () => {
    docApi.doc = null; docApi.loading = true;
    await mount({ path: PATH });
    expect(q('[data-testid="atp-view-file"]')?.textContent).toContain('Loading agent');
    docApi.loading = false; docApi.error = 'no access';
    await mount({ path: PATH });
    expect(host.textContent).toContain('no access');
    docApi.error = null;
    await mount({ path: PATH });
    expect(host.textContent).toContain('Agent not available');
    docApi.doc = baseDoc({ text: null, tooLarge: true });
    await mount({ path: PATH });
    expect(host.textContent).toContain('too large');
  });

  it('badges unsaved and lease holder, and toggles the diff vs disk', async () => {
    docApi.doc = baseDoc({ dirty: true, savedText: 'a\nold\nc', text: 'a\nnew\nc', lease: { clientId: 'c', label: 'Studio window', since: 1, renewedAt: 1 } });
    await mount({ path: PATH });
    expect(host.textContent).toContain('Unsaved in Studio');
    expect(host.textContent).toContain('Editing in Studio · Studio window');
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Diff vs disk')!);
    const diff = q('[aria-label="Diff vs disk"]')!;
    expect(diff.querySelector('.del')?.textContent).toContain('old');
    expect(diff.querySelector('.add')?.textContent).toContain('new');
    expect(q('[data-testid="code-stub"]')).toBeNull();
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Hide diff')!);
    expect(q('[data-testid="code-stub"]')).not.toBeNull();
  });

  it('says so when the diff is too large', async () => {
    const big = (tag: string) => Array.from({ length: 1600 }, (_, i) => `${tag}${i}`).join('\n');
    docApi.doc = baseDoc({ dirty: true, savedText: big('a'), text: big('b'), lease: { clientId: 'c', label: '', since: 1, renewedAt: 1 } });
    await mount({ path: PATH });
    expect(host.textContent).toContain('Editing in Studio');
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Diff vs disk')!);
    expect(host.textContent).toContain('diff is too large');
  });

  it('lists problems and reveals the line on click', async () => {
    docApi.doc = baseDoc({ diagnostics: [{ line: 3, column: 1, endLine: 3, endColumn: 2, severity: 'error', message: 'bad thing' }] });
    await mount({ path: PATH });
    await click([...host.querySelectorAll('.sf-atp-link')].find(b => b.textContent?.includes('bad thing'))!);
    expect(q('[data-testid="code-stub"]')?.getAttribute('data-line')).toBe('3');
  });

  it('accepts and rejects proposals, showing errors and the waiting state', async () => {
    docApi.doc = baseDoc({ proposals: [proposal('p1'), proposal('p2', 'accept-requested'), proposal('p3', 'accepted')] });
    await mount({ path: PATH });
    const cards = host.querySelectorAll('[data-testid="atp-proposal"]');
    expect(cards).toHaveLength(2);
    expect(cards[0]!.querySelector('.add')?.textContent).toContain('B');
    expect(cards[1]!.textContent).toContain('Waiting for Studio to apply');
    // While Studio applies only Reject stays: the server refuses it while Studio holds the file and allows it once Studio is gone.
    expect([...cards[1]!.querySelectorAll('button')].map(b => b.textContent)).toEqual(['Reject']);
    docApi.resolve.mockResolvedValueOnce({ ok: false, code: 'leased', error: 'Studio is applying this proposal.' });
    await click([...cards[1]!.querySelectorAll('button')].find(b => b.textContent === 'Reject')!);
    expect(docApi.resolve).toHaveBeenLastCalledWith('p2', 'reject', undefined);
    expect(cards[1]!.textContent).toContain('Studio is applying this proposal.');
    await click([...cards[0]!.querySelectorAll('button')].find(b => b.textContent === 'Accept')!);
    expect(docApi.resolve).toHaveBeenCalledWith('p1', 'accept', 'x'.repeat(64));
    docApi.resolve.mockResolvedValueOnce({ ok: false, error: 'conflict: file changed' });
    await click([...cards[0]!.querySelectorAll('button')].find(b => b.textContent === 'Accept')!);
    expect(cards[0]!.textContent).toContain('conflict: file changed');
    docApi.resolve.mockResolvedValueOnce({ ok: false });
    await click([...cards[0]!.querySelectorAll('button')].find(b => b.textContent === 'Reject')!);
    expect(cards[0]!.textContent).toContain('Could not reject');
    expect(docApi.resolve).toHaveBeenLastCalledWith('p1', 'reject', undefined);
    docApi.resolve.mockRejectedValueOnce(new Error('network'));
    await click([...cards[0]!.querySelectorAll('button')].find(b => b.textContent === 'Reject')!);
    expect(cards[0]!.textContent).toContain('network');
  });

  it('explains a conflict on accept and disables Accept for a stale proposal', async () => {
    docApi.doc = baseDoc({ proposals: [proposal('p1'), { ...proposal('p2'), input: { path: PATH, expectedSha256: 'y'.repeat(64), summary: 'old one' } }] });
    await mount({ path: PATH });
    const cards = host.querySelectorAll('[data-testid="atp-proposal"]');
    docApi.resolve.mockResolvedValueOnce({ ok: false, code: 'conflict', error: 'Reload first.' });
    await click([...cards[0]!.querySelectorAll('button')].find(b => b.textContent === 'Accept')!);
    expect(cards[0]!.querySelector('[role="alert"]')?.textContent).toBe('The file changed since this edit was proposed. Reload first.');
    expect(cards[0]!.querySelector('[data-testid="atp-stale"]')).toBeNull();
    // A body-less proposal (the server strips resolved ones) renders without a diff and is marked stale against the current file.
    expect(cards[1]!.querySelector('[data-testid="atp-stale"]')?.textContent).toContain('Stale');
    expect(cards[1]!.textContent).toContain('No diff preview available');
    const accept = [...cards[1]!.querySelectorAll('button')].find(b => b.textContent === 'Accept') as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(([...cards[1]!.querySelectorAll('button')].find(b => b.textContent === 'Reject') as HTMLButtonElement).disabled).toBe(false);
  });

  it('degrades the proposal diff when it cannot be applied', async () => {
    docApi.doc = baseDoc({ text: null, proposals: [proposal('p1')] });
    await mount({ path: PATH });
    expect(host.textContent).toContain('No diff preview available');
    docApi.doc = baseDoc({ proposals: [{ ...proposal('p2'), input: { path: PATH, expectedSha256: 'x', edits: [{ startLine: 99, endLine: 98, text: 'z' }], summary: 's' } }] });
    await mount({ path: PATH });
  });

  it('mounts views lazily and keeps them mounted across tab switches', async () => {
    await mount({ path: PATH });
    expect(q('[data-testid="atp-view-preview"]')).toBeNull();
    await click(tab('Preview'));
    expect(previewMounts).toHaveBeenCalled();
    const before = previewMounts.mock.calls.length;
    expect(q('[data-testid="preview-stub"]')?.textContent).toBe(JSON.stringify({ path: PATH }));
    // The Preview is bound to this panel's agent, not the thread's shared target.
    expect(q('[data-testid="preview-stub"]')?.getAttribute('data-pinned')).toBe(PATH);
    await click(tab('File'));
    expect(q('[data-testid="atp-view-preview"]')?.hasAttribute('hidden')).toBe(true);
    await click(tab('Preview'));
    expect(q('[data-testid="atp-view-preview"]')?.hasAttribute('hidden')).toBe(false);
    expect(host.querySelectorAll('[data-testid="preview-stub"]')).toHaveLength(1);
    expect(previewMounts.mock.calls.length - before).toBeLessThanOrEqual(2);
  });

  it('passes runId and turn to the preview', async () => {
    await mount({ path: PATH, view: 'preview', runId: 'run-1', turn: '2' });
    expect(q('[data-testid="preview-stub"]')?.textContent).toBe(JSON.stringify({ path: PATH, runId: 'run-1', turn: '2' }));
    expect(tab('Preview').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the tests summary for this agent only', async () => {
    suites = [
      { id: 's1', path: 'tests/QC.scenario.json', cases: [{ id: 'c1', name: 'one', utterances: [], expect: {} }, { id: 'c2', name: 'two', utterances: [], expect: {} }], lastResults: { c1: { outcome: 'pass', at: 5 }, c2: { outcome: 'fail', at: 6 } } },
      { id: 's2', path: 'tests/QC.scenario.json', cases: [{ id: 'c3', name: 'three', utterances: [], expect: {} }] },
      { id: 's3', path: 'tests/Other.scenario.json', cases: [] },
      { id: 's4', path: PATH, cases: [] }
    ];
    await mount({ path: PATH, view: 'tests' });
    const text = q('[data-testid="atp-tests"]')!.textContent!;
    expect(text).toContain('1/2 passed');
    expect(text).toContain('not run');
    expect(text).toContain('1 case');
    expect(q('[data-testid="atp-tests"]')!.querySelectorAll('.sf-atp-card')).toHaveLength(2);
    suites = [];
    await mount({ path: PATH, view: 'tests' });
    expect(host.textContent).toContain('No saved test suites');
    // suite files are tests/<Name>.scenario.json: the agent file path never matches one
    suites = [{ id: 's9', path: PATH, cases: [] }];
    await mount({ path: PATH, view: 'tests' });
    expect(host.textContent).toContain('No saved test suites');
  });

  it('feeds the graph from the doc text and focuses the node', async () => {
    await mount({ path: PATH, view: 'graph', node: 'topic.t' });
    expect(q('[data-testid="graph-stub"]')?.textContent).toBe('a\nb\nc|topic.t');
    await click(q('[data-testid="graph-stub"]'));
    expect(tab('Actions').getAttribute('aria-selected')).toBe('true');
    docApi.doc = null;
    await mount({ path: PATH, view: 'graph' });
    expect(host.textContent).toContain('graph needs the agent text');
  });

  it('lists actions parsed from the doc and reveals lines in the file', async () => {
    await mount({ path: PATH, view: 'actions' });
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'act:Lookup')!);
    expect(rpc).toHaveBeenCalledWith('salesforce', 'agentScript.parse', { source: 'a\nb\nc' });
    await click(q('[data-testid="action-panel"]'));
    expect(tab('File').getAttribute('aria-selected')).toBe('true');
    expect(q('[data-testid="code-stub"]')?.getAttribute('data-line')).toBe('9');
  });

  it('reports action parse failures', async () => {
    rpc.mockImplementation(async (_p: string, method: string) => method === 'agentScript.parse' ? { ok: false, error: 'parse down' } : { ok: true, comments: [] });
    await mount({ path: PATH, view: 'actions' });
    expect(host.textContent).toContain('parse down');
    rpc.mockImplementation(async () => { throw new Error('rpc exploded'); });
    await mount({ path: PATH, view: 'actions' });
    expect(host.textContent).toContain('rpc exploded');
    docApi.doc = baseDoc({ text: null });
    await mount({ path: PATH, view: 'actions' });
  });

  it('shows comments for the path and reloads on realtime changes', async () => {
    await mount({ path: PATH, view: 'comments' });
    expect(host.textContent).toContain('Please fix');
    const calls = rpc.mock.calls.filter(c => c[1] === 'studio.comments.list').length;
    await act(async () => { realtime?.({ kind: 'comments', projectId: 'proj-1' }); });
    await act(async () => { realtime?.({ kind: 'threads', projectId: 'proj-1' }); });
    await flush();
    expect(rpc.mock.calls.filter(c => c[1] === 'studio.comments.list').length).toBe(calls + 1);
    rpc.mockRejectedValue(new Error('x'));
    await act(async () => { realtime?.({ kind: 'comments' }); });
  });

  it('opens in the Studio window when one is live, else the project tab', async () => {
    openInStudioWindow.mockResolvedValueOnce(true);
    await mount({ path: PATH, line: '7' });
    const button = [...host.querySelectorAll('button')].find(b => b.textContent?.startsWith('Open in Studio'))!;
    await click(button);
    expect(openInStudioWindow).toHaveBeenCalledWith(expect.objectContaining({ pluginId: 'salesforce', projectId: 'proj-1', path: PATH, line: 7 }));
    expect(navigate.toProject).not.toHaveBeenCalled();
    await click(button);
    expect(queue).toHaveBeenCalledWith('proj-1', PATH);
    expect(navigate.toProject).toHaveBeenCalledWith('proj-1', { tabId: 'salesforce' });
  });

  it('opens Tests in Studio from the tests view', async () => {
    await mount({ path: PATH, view: 'tests' });
    await click([...host.querySelectorAll('button')].find(b => b.textContent === 'Open Tests in Studio')!);
    expect(navigate.toProject).toHaveBeenCalledWith('proj-1', { tabId: 'salesforce' });
  });

  it('C: keeps the picked view across a host tab switch (remount), per panel tab and agent', async () => {
    const first = await mount({ path: PATH }, 'tab-1');
    await click(tab('Graph'));
    first.unmount();
    await mount({ path: PATH }, 'tab-1');
    expect(tab('Graph').getAttribute('aria-selected')).toBe('true');
    // Another panel tab, or the same tab on another agent, starts on its card's view.
    await mount({ path: PATH }, 'tab-2');
    expect(tab('File').getAttribute('aria-selected')).toBe('true');
    await mount({ path: 'force-app/Other.agent' }, 'tab-1');
    expect(tab('File').getAttribute('aria-selected')).toBe('true');
  });

  it('C: a card that retargets the panel wins over the remembered view, and that view is kept next', async () => {
    const first = await mount({ path: PATH }, 'tab-1');
    await click(tab('Graph'));
    await first.rerender({ path: PATH, view: 'tests' });
    expect(tab('Tests').getAttribute('aria-selected')).toBe('true');
    first.unmount();
    const second = await mount({ path: PATH, view: 'tests' }, 'tab-1');
    expect(tab('Tests').getAttribute('aria-selected')).toBe('true');
    second.unmount();
    // A different card for the same agent opens on its own view, not the remembered one.
    await mount({ path: PATH, view: 'actions' }, 'tab-1');
    expect(tab('Actions').getAttribute('aria-selected')).toBe('true');
  });

  it('C: unreadable or invalid stored views fall back to the card view', async () => {
    sessionStorage.setItem(`sf-atp-view:tab-1:${PATH}`, '{bad');
    const first = await mount({ path: PATH }, 'tab-1');
    expect(tab('File').getAttribute('aria-selected')).toBe('true');
    first.unmount();
    sessionStorage.setItem(`sf-atp-view:tab-1:${PATH}`, JSON.stringify({ view: 'bogus', card: JSON.stringify(['file', null, null, null, null]) }));
    const second = await mount({ path: PATH }, 'tab-1');
    expect(tab('File').getAttribute('aria-selected')).toBe('true');
    second.unmount();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    await mount({ path: PATH }, 'tab-1');
    await click(tab('Graph'));
    expect(tab('Graph').getAttribute('aria-selected')).toBe('true');
    set.mockRestore();
  });

  it('switches views with arrow keys and follows retargeted params', async () => {
    const { rerender } = await mount({ path: PATH });
    const list = q('[role="tablist"]')!;
    await act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(tab('Preview').getAttribute('aria-selected')).toBe('true');
    await act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    await act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); });
    expect(tab('Comments').getAttribute('aria-selected')).toBe('true');
    await act(async () => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
    expect(tab('Comments').getAttribute('aria-selected')).toBe('true');
    await rerender({ path: PATH, view: 'graph', node: 'n2' });
    expect(tab('Graph').getAttribute('aria-selected')).toBe('true');
    expect(q('[data-testid="graph-stub"]')?.textContent).toContain('|n2');
  });
});
