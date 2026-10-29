/**
 * @vitest-environment happy-dom
 *
 * The Studio against the shared agent document (hook mocked) and the preview intent.
 */
import React, { act, createElement, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentDraftKey, writeAgentDraft } from './agent-script-drafts.js';
import { PLAYGROUND_BRIDGE_SOURCE } from './playground-bridge.js';

// The shared-document hook is mocked with a tiny store so a test can change the doc and the Studio re-renders.
const store = {
  state: { doc: null as any, loading: false, error: null as string | null, leased: false, leaseGen: 0, heldBy: null as any },
  listeners: new Set<() => void>(),
  set(patch: Record<string, unknown>) { store.state = { ...store.state, ...patch }; store.listeners.forEach(fn => fn()); }
};
const docApi = { release: vi.fn(async () => undefined), resume: vi.fn(), update: vi.fn(), saved: vi.fn(async () => undefined), takeOver: vi.fn(async () => true), propose: vi.fn(async () => null), resolve: vi.fn(async () => ({ ok: true })), reload: vi.fn() };
const hook: { editor?: { clientId: string; label: string }; scope?: string } = {};
vi.mock('./agent-doc/useAgentScriptDoc.js', () => ({
  newAgentDocClientId: () => 'client-1',
  stableAgentDocClientId: (scope: string) => { hook.scope = scope; return 'client-1'; },
  useAgentScriptDoc: (_p: string, _proj: string | null, _path: string | null, options?: { editor?: { clientId: string; label: string } }) => {
    hook.editor = options?.editor;
    const state = useSyncExternalStore(fn => { store.listeners.add(fn); return () => { store.listeners.delete(fn); }; }, () => store.state);
    return { ...state, ...docApi };
  }
}));
vi.mock('./preview/PreviewRunReplay.js', () => ({ PreviewRunReplay: (p: any) => <div data-testid="stub-replay" data-run={p.runId} data-turn={String(p.turn ?? '')}><button data-testid="stub-replay-close" onClick={p.onClose}>close</button></div> }));
const control: { options?: any; closeHandler?: ((signal: AbortSignal) => Promise<void>) | null } = {};
const closeControls = vi.fn(async (_project: string) => undefined);
vi.mock('./useSalesforceControl.js', async importOriginal => ({ ...(await importOriginal<object>()), resumeSalesforceControls: vi.fn(), closeSalesforceControls: (project: string) => closeControls(project), useSalesforceControl: (options: unknown) => { control.options = options; } }));
vi.mock('./preview/PreviewWorkbench.js', () => ({ PreviewWorkbench: (p: any) => <div data-testid="stub-preview" data-engine={p.engine} data-dirty={String(Boolean(p.dirty))} data-command={p.command ? JSON.stringify(p.command) : ""}><button data-testid="stub-run" onClick={() => p.onRunChange({ runId: 'r1', engine: 'live', turn: 1 })}>run</button><button data-testid="stub-handled" onClick={() => p.onCommandHandled(p.command?.seq ?? -1)}>handled</button><button data-testid="stub-stale" onClick={() => p.onCommandHandled(0)}>stale</button></div> }));
vi.mock('./studio/AskAgentButton.js', () => ({ AskAgentButton: () => <div data-testid="stub-ask-agent" /> }));
vi.mock('./AgentScriptGraphPanel.js', () => ({ AgentScriptGraphPanel: (p: any) => <div data-testid="stub-graph" data-focus={`${p.focusNode}:${p.focusSeq}`} data-compact={String(p.compact)} /> }));
vi.mock('./OrgAgentsPanel.js', () => ({ OrgAgentsPanel: () => <div data-testid="stub-agents" /> }));
vi.mock('./AgentforceLabPanel.js', () => ({ AgentforceLabPanel: () => <div data-testid="stub-lab" /> }));
vi.mock('./panels/OperationsPanel.js', () => ({ OperationsPanel: () => <div data-testid="stub-ops" /> }));
vi.mock('./studio/OrgTestsView.js', () => ({ OrgTestsView: (p: any) => <div data-testid="stub-org-tests" data-visible={String(p.visible)} data-focus={p.focus ? JSON.stringify(p.focus) : ''}><button data-testid="stub-org-tests-handled" onClick={() => p.onFocusHandled?.(p.focus?.seq ?? -1)}>handled</button></div> }));
const { AgentScriptPanel } = await import('./AgentScriptPanel.js');
const { routeStudioIntent } = await import('./studio/studio-intents.js');
const windowRoute = await import('./studio-window-route.js');
const navigation: { toCompose: ReturnType<typeof vi.fn>; openInWindow?: ReturnType<typeof vi.fn> } = { toCompose: vi.fn() };

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise(r => setTimeout(r, 0)); });
let width = 1000;
const observers: Array<(w: number) => void> = [];
const SHA = 'a'.repeat(64);
const SOURCE = 'start_agent:\n  a\n  b\n';
const baseRpc = async (_p: string, method: string, args?: any): Promise<unknown> => {
  if (method === 'status') return { dxProject: true, agentScriptDialect: 'agentforce', projectRoot: '/proj' };
  if (method === 'agentFiles.list') return { ok: true, files: [{ apiName: 'QC', path: 'force-app/bots/QC.agent', lines: 4 }, { apiName: 'Help', path: 'force-app/bots/Help.agent', lines: 4 }] };
  if (method === 'org') return { ok: true, org: { alias: 'dev', username: 'd@x.com', orgId: '00D', instanceUrl: 'https://x', apiVersion: '62.0', kind: 'sandbox', isDefault: true } };
  if (method === 'orgs') return { ok: true, selectedAlias: 'dev', orgs: [] };
  if (method === 'agentFiles.read') return { ok: true, file: { path: args?.path, content: SOURCE, sha256: SHA } };
  if (method === 'agentFiles.write') return { ok: true, file: { path: args?.path, sha256: 'sha2' } };
  if (method === 'studio.explorer') return { ok: true, nodes: [{ kind: 'agent', path: 'force-app/bots/QC.agent', apiName: 'QC' }, { kind: 'apex', apiName: 'Foo', path: 'force-app/classes/Foo.cls', usedBy: ['force-app/bots/QC.agent'] }, { kind: 'scenario', path: 'tests/a.scenario.json', apiName: 'a' }, { kind: 'org-agent', apiName: 'OrgBot' }] };
  if (method === 'studio.suites.list') return { ok: true, suites: [{ id: 's', path: 'tests/a.scenario.json', cases: [], lastResults: { x: { outcome: 'fail', runId: 'r', at: 1 } } }] };
  if (method === 'studio.comments.list') return { ok: true, comments: [] };
  if (method === 'studio.comments.add') return { ok: true };
  if (method === 'studio.askAgent') return { ok: true, threadId: 't1' };
  if (method === 'release.state') return { ok: true, data: { org: { alias: 'dev', orgId: '00D', kind: 'sandbox' }, agent: { apiName: 'QC', path: args?.path, revision: SHA, versioned: false, lastPublish: null }, needsReadApproval: false, readUntil: null, versions: [] } };
  return { ok: false };
};
const rpc = vi.fn(baseRpc);
let surface: string | undefined;
let resourceId: string | undefined;
let realtime: ((p: unknown) => void) | undefined;
const nodes: Array<() => void> = [];

async function mount(arg: string | { subPath?: string; params?: unknown; threadId?: string } = {}, extra: { params?: unknown } = {}) {
  const props = typeof arg === 'string' ? { subPath: arg, ...extra } : arg;
  const el = document.createElement('div'); document.body.appendChild(el);
  const root = createRoot(el);
  nodes.push(() => { root.unmount(); el.remove(); });
  await act(async () => { root.render(createElement(AgentScriptPanel, { pluginId: 'salesforce', subPath: props.subPath ?? '', params: props.params, projectId: 'proj-1', orgPicker: false, ...('threadId' in props && props.threadId ? { threadId: props.threadId } : {}) })); });
  await flush();
  return el;
}
const post = async (el: HTMLElement, data: Record<string, unknown>) => {
  await act(async () => { window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: el.querySelector('iframe')!.contentWindow, data: { source: PLAYGROUND_BRIDGE_SOURCE, ...data } })); });
  await flush();
};
const ready = (el: HTMLElement) => post(el, { type: 'ready' });
const resize = async (w: number) => { width = w; await act(async () => { observers.forEach(cb => cb(w)); }); };
const exec = (command: string, input: Record<string, unknown> = {}) => control.options.execute({ id: 'c1', command, input });
const sent = (el: HTMLElement) => (el.querySelector('iframe')!.contentWindow!.postMessage as any).mock.calls.map((c: any[]) => c[0]);

beforeEach(() => {
  delete navigation.openInWindow; rpc.mockImplementation(baseRpc);
  localStorage.clear(); store.state = { doc: null, loading: false, error: null, leased: false, leaseGen: 0, heldBy: null }; surface = undefined; resourceId = undefined; Object.values(docApi).forEach(fn => fn.mockClear()); rpc.mockClear(); observers.length = 0; width = 1000; realtime = undefined; control.closeHandler = undefined; closeControls.mockReset();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect);
  (globalThis as any).ResizeObserver = class { constructor(cb: any) { observers.push(w => cb([{ contentRect: { width: w } }])); } observe() {} disconnect() {} };
  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockImplementation(function (this: HTMLIFrameElement) {
    const self = this as any;
    return self.__win ??= Object.assign(Object.create(window), { postMessage: vi.fn() });
  });
  (globalThis as any).__ZCC_PLUGIN_HOST__ = { callRpc: rpc, useZccNavigate: () => ({ toCompose: vi.fn() }), getSettings: async () => ({ values: { agentScriptDialect: 'agentforce' } }), setSettings: async () => undefined };
  (globalThis as any).__ZCC_PLUGIN_RUNTIME__ = {
    useWindowCloseHandler: (handler: ((signal: AbortSignal) => Promise<void>) | null) => { control.closeHandler = handler; },
    useZccNavigate: () => navigation,
    useSettings: () => ({ values: { agentScriptDialect: 'agentforce', defaultOrg: 'dev' }, isLoading: false }),
    useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; },
    useZccContext: () => ({ projectId: 'proj-1', threadId: null, ...(surface ? { surface, resourceId } : {}) })
  };
});
afterEach(() => { nodes.splice(0).forEach(fn => fn()); vi.restoreAllMocks(); delete (globalThis as any).__ZCC_PLUGIN_HOST__; delete (globalThis as any).__ZCC_PLUGIN_RUNTIME__; });


const PATH = 'force-app/bots/QC.agent';
const FOLLOWER_HELD = { id: 'X1', clientId: 'other', label: 'Studio window', since: 1, renewedAt: 1 };
const proposal = (id: string, status: string, input: Record<string, unknown> = {}) => ({ id, status, createdAt: 1, input: { path: PATH, expectedSha256: SHA, summary: 'tweak', content: 'new text\n', ...input } });
const docOf = (proposals: unknown[] = []) => ({ projectId: 'proj-1', path: PATH, rev: 1, text: SOURCE, baseSha256: SHA, savedText: null, dirty: false, diagnostics: [], lease: null, lastWriter: null as string | null, proposals, updatedAt: 1 });
const open = async () => { const el = await mount(PATH); await ready(el); await post(el, { type: 'snapshot', content: SOURCE, issues: 0 }); return el; };
const saveButton = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('[data-testid="salesforce-agent-script-save"]')!;

describe('AgentScriptPanel shared document', () => {
  it('shows a read-only banner while another window holds the lease, and Take over claims it', async () => {
    const el = await open();
    expect(el.querySelector('[data-testid="salesforce-agent-held-banner"]')).toBeNull();
    await act(async () => { store.set({ doc: docOf(), heldBy: { clientId: 'other', label: 'Studio window', since: 1, renewedAt: 1 } }); });
    const banner = el.querySelector('[data-testid="salesforce-agent-held-banner"]')!;
    expect(banner.textContent).toContain('Studio window is editing this agent');
    expect(saveButton(el).disabled).toBe(true);
    await act(async () => { fireEvent.click([...banner.querySelectorAll('button')].find(b => b.textContent === 'Take over')!); });
    expect(docApi.takeOver).toHaveBeenCalledTimes(1);
    await act(async () => { store.set({ heldBy: null, leased: true }); });
    expect(el.querySelector('[data-testid="salesforce-agent-held-banner"]')).toBeNull();
  });

  it('applies a proposal another surface asked to accept, then resolves it applied', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('p1', 'accept-requested')]) }); });
    await flush();
    const write = rpc.mock.calls.find(c => c[1] === 'agentFiles.write');
    expect(write?.[2]).toMatchObject({ path: PATH, content: 'new text\n', expectedSha256: SHA });
    expect(docApi.saved).toHaveBeenCalledWith('sha2', 'new text\n');
    expect(docApi.resolve).toHaveBeenCalledWith('p1', 'applied', 'sha2');
    expect(sent(el).some((m: any) => m.type === 'fileChanged' && m.content === 'new text\n' && m.sha256 === 'sha2')).toBe(true);
    // The same proposal is not applied twice when the document re-renders.
    await act(async () => { store.set({ doc: docOf([proposal('p1', 'accept-requested')]) }); });
    expect(rpc.mock.calls.filter(c => c[1] === 'agentFiles.write')).toHaveLength(1);
  });

  it('rejects an accepted proposal whose write fails', async () => {
    const el = await open();
    rpc.mockImplementation(async (p, method, args) => method === 'agentFiles.write' ? { ok: false, error: 'conflict on disk' } : baseRpc(p, method, args));
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('p2', 'accept-requested')]) }); });
    await flush();
    expect(docApi.resolve).toHaveBeenCalledWith('p2', 'reject');
    expect(el.textContent).toContain('conflict on disk');
    rpc.mockImplementation(baseRpc);
  });

  it('shows a proposal created elsewhere in the editor', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('p3', 'pending', { content: undefined, edits: [{ startLine: 2, endLine: 2, text: '  z' }] })]) }); });
    await flush();
    expect(sent(el).find((m: any) => m.type === 'proposeEdit')).toMatchObject({ proposalId: 'p3', content: 'start_agent:\n  z\n  b\n', summary: 'tweak', actor: 'Agent' });
    expect(docApi.resolve).not.toHaveBeenCalled();
  });

  it('leaves a pending proposal written against another version pending: not shown, not rejected', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('p4', 'pending', { expectedSha256: 'b'.repeat(64) })]) }); });
    await flush();
    expect(docApi.resolve).not.toHaveBeenCalled();
    expect(sent(el).filter((m: any) => m.type === 'proposeEdit' && m.proposalId === 'p4')).toHaveLength(0);
  });

  it('settles the review of a shown proposal when the thread accepts it, then applies it on a clean buffer', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('s1', 'pending')]) }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'proposeEdit' && m.proposalId === 's1')).toHaveLength(1);
    await act(async () => { store.set({ doc: docOf([proposal('s1', 'accept-requested')]) }); });
    await flush();
    expect(sent(el).some((m: any) => m.type === 'clearProposal' && m.proposalId === 's1')).toBe(true);
    expect(rpc.mock.calls.filter(c => c[1] === 'agentFiles.write')).toHaveLength(1);
    expect(docApi.resolve).toHaveBeenCalledWith('s1', 'applied', 'sha2');
    // Re-rendering with the same status does not apply it twice.
    await act(async () => { store.set({ doc: docOf([proposal('s1', 'accept-requested')]) }); });
    expect(rpc.mock.calls.filter(c => c[1] === 'agentFiles.write')).toHaveLength(1);
  });

  it('the next save writes on top of an applied thread edit', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('n1', 'accept-requested')]) }); });
    await flush();
    rpc.mockClear();
    await post(el, { type: 'persist', path: PATH, content: 'new text\nmore\n' });
    expect(rpc.mock.calls.find(c => c[1] === 'agentFiles.write')?.[2]).toMatchObject({ expectedSha256: 'sha2' });
  });

  it('does not write an accepted proposal over unsaved edits: a whole-file one goes to the editor review', async () => {
    const el = await open();
    await post(el, { type: 'dirty', dirty: true, baseSha: SHA });
    await post(el, { type: 'snapshot', content: 'my unsaved edit\n', issues: 0 });
    rpc.mockClear();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('d1', 'accept-requested')]) }); });
    await flush();
    expect(rpc.mock.calls.some(c => c[1] === 'agentFiles.write')).toBe(false);
    expect(sent(el).find((m: any) => m.type === 'proposeEdit' && m.proposalId === 'd1')).toMatchObject({ content: 'new text\n' });
    expect(docApi.resolve).not.toHaveBeenCalled();
    // The person accepts it in the editor.
    await post(el, { type: 'proposalResolved', proposalId: 'd1', outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0, content: 'new text\n', sha256: 'sha9' });
    expect(docApi.resolve).toHaveBeenCalledWith('d1', 'applied', 'sha9');
  });

  it('rejects an accepted line-edit proposal over unsaved edits, and one for another version, with a visible reason', async () => {
    const el = await open();
    await post(el, { type: 'dirty', dirty: true, baseSha: SHA });
    rpc.mockClear();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('d2', 'accept-requested', { content: undefined, edits: [{ startLine: 2, endLine: 2, text: 'z' }] })]) }); });
    await flush();
    expect(rpc.mock.calls.some(c => c[1] === 'agentFiles.write')).toBe(false);
    expect(docApi.resolve).toHaveBeenCalledWith('d2', 'reject');
    expect(el.textContent).toContain('it changes lines, and you have unsaved edits');
    await post(el, { type: 'dirty', dirty: false, baseSha: SHA });
    await act(async () => { store.set({ doc: docOf([proposal('d3', 'accept-requested', { expectedSha256: 'c'.repeat(64) })]) }); });
    await flush();
    expect(rpc.mock.calls.some(c => c[1] === 'agentFiles.write')).toBe(false);
    expect(docApi.resolve).toHaveBeenCalledWith('d3', 'reject');
    expect(el.textContent).toContain('the file changed after it was proposed');
  });

  it('retracts a shown proposal that was rejected or applied elsewhere, or that vanished', async () => {
    const el = await open();
    const shown = () => sent(el).filter((m: any) => m.type === 'proposeEdit').map((m: any) => m.proposalId);
    const cleared = () => sent(el).filter((m: any) => m.type === 'clearProposal').map((m: any) => m.proposalId);
    // One review at a time: r1 is shown, the others wait.
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('r1', 'pending'), proposal('r2', 'pending'), proposal('r3', 'pending')]) }); });
    await flush();
    expect(shown()).toEqual(['r1']);
    // Each one decided elsewhere leaves the frame and the next is shown.
    await act(async () => { store.set({ doc: docOf([proposal('r1', 'rejected'), proposal('r2', 'pending'), proposal('r3', 'pending')]) }); });
    await flush();
    expect(cleared()).toContain('r1'); expect(shown()).toEqual(['r1', 'r2']);
    await act(async () => { store.set({ doc: docOf([proposal('r1', 'rejected'), proposal('r2', 'accepted'), proposal('r3', 'pending')]) }); });
    await flush();
    expect(cleared()).toContain('r2'); expect(shown()).toEqual(['r1', 'r2', 'r3']);
    await act(async () => { store.set({ doc: docOf([proposal('r1', 'rejected'), proposal('r2', 'accepted')]) }); });
    await flush();
    expect(cleared()).toContain('r3');
    // Nothing is resolved on the server for decisions made elsewhere, and nothing is shown again.
    expect(docApi.resolve).not.toHaveBeenCalled();
    await act(async () => { store.set({ doc: docOf([proposal('r1', 'rejected'), proposal('r2', 'accepted')]) }); });
    expect(shown()).toHaveLength(3);
  });

  it('a command waiting on a proposal learns it was rejected from the thread', async () => {
    const el = await open();
    const outcome = exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, content: 'agent text\n', summary: 'mine' });
    await flush();
    const own = sent(el).find((m: any) => m.type === 'proposeEdit');
    expect(own).toBeTruthy();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal(own.proposalId, 'pending', { content: 'agent text\n' })]) }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'proposeEdit')).toHaveLength(1); // its own is not shown twice
    await act(async () => { store.set({ doc: docOf([proposal(own.proposalId, 'rejected')]) }); });
    await expect((await outcome as any).settled).resolves.toMatchObject({ outcome: 'rejected' });
  });

  it('follows the holder read-only: the frame locks, shows the holder text and unlocks on release', async () => {
    const el = await open();
    await act(async () => { store.set({ doc: { ...docOf(), text: 'holder typing\n' }, heldBy: { clientId: 'other', label: 'Studio window', since: 1, renewedAt: 1 } }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toMatchObject({ readOnly: true, content: 'holder typing\n' });
    await act(async () => { store.set({ doc: { ...docOf(), text: 'holder typing more\n' } }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toMatchObject({ readOnly: true, content: 'holder typing more\n' });
    await act(async () => { store.set({ heldBy: null, leased: true }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toEqual(expect.objectContaining({ readOnly: false }));
    const count = sent(el).filter((m: any) => m.type === 'setReadOnly').length;
    await act(async () => { store.set({ doc: docOf() }); });
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly')).toHaveLength(count); // never locked: no traffic
  });

  it('locks without text when the holder document is too large', async () => {
    const el = await open();
    await act(async () => { store.set({ doc: { ...docOf(), text: null, tooLarge: true }, heldBy: { clientId: 'other', label: 'W', since: 1, renewedAt: 1 } }); });
    await flush();
    const last = sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1);
    expect(last.readOnly).toBe(true); expect('content' in last).toBe(false);
  });

  it('on gaining the lease it loads another client\'s unsaved text instead of pushing its own', async () => {
    const el = await open();
    docApi.update.mockClear();
    await act(async () => { store.set({ leased: true, leaseGen: 1, doc: { ...docOf(), dirty: true, text: 'other client unsaved\n', savedText: SOURCE, lastWriter: 'other' } }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toMatchObject({ readOnly: false, content: 'other client unsaved\n', baseline: SOURCE, baseSha: SHA });
    expect(docApi.update).not.toHaveBeenCalledWith(SOURCE, expect.anything(), SHA);
    expect(docApi.update.mock.calls.some(c => c[0] === SOURCE)).toBe(false);
  });

  it('recovers the former holder last keystroke before unlocking and publishing stale follower text', async () => {
    const el = await open();
    await act(async () => { store.set({ heldBy: FOLLOWER_HELD, doc: docOf() }); });
    writeAgentDraft({ key: agentDraftKey('proj-1', `file:${PATH}`), dialect: 'agentforce', content: 'last keystroke before close\n', baseSha: SHA });
    docApi.update.mockClear();
    await act(async () => { store.set({ heldBy: null, leased: true, leaseGen: 1, doc: docOf() }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toMatchObject({ readOnly: false, content: 'last keystroke before close\n' });
    expect(docApi.update).toHaveBeenCalledWith('last keystroke before close\n', undefined, SHA);
    expect(docApi.update.mock.calls.some(call => call[0] === SOURCE)).toBe(false);
  });

  it('uses the former holder observed edit even when it returns to the follower-start recovery text', async () => {
    const key = agentDraftKey('proj-1', `file:${PATH}`);
    writeAgentDraft({ key, dialect: 'agentforce', content: 'holder final text', baseSha: SHA });
    const el = await open();
    await act(async () => { store.set({ heldBy: FOLLOWER_HELD, doc: docOf() }); });
    const raw = (content: string) => JSON.stringify([{ key, content, dialect: 'agentforce', baseSha: SHA }]);
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'other-setting', oldValue: raw('unrelated'), newValue: raw('holder final text') }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'salesforce.agent-drafts.v1', oldValue: '{broken', newValue: '{}' }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'salesforce.agent-drafts.v1', oldValue: raw('intermediate holder edit'), newValue: raw('holder final text') }));
    });
    docApi.update.mockClear();
    await act(async () => { store.set({ heldBy: null, leased: true, leaseGen: 1, doc: docOf() }); });
    expect(docApi.update).toHaveBeenCalledWith('holder final text', undefined, SHA);
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toMatchObject({ readOnly: false, content: 'holder final text' });
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'salesforce.agent-drafts.v1', oldValue: raw('a'), newValue: raw('b') })); });
  });

  it('keeps a follower locked until its new edit grant arrives', async () => {
    const el = await open();
    await act(async () => { store.set({ heldBy: FOLLOWER_HELD, doc: docOf() }); });
    await act(async () => { store.set({ heldBy: null, leased: false }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toMatchObject({ readOnly: true });
    await act(async () => { store.set({ leased: true, leaseGen: 1 }); });
    expect(sent(el).filter((m: any) => m.type === 'setReadOnly').at(-1)).toMatchObject({ readOnly: false });
  });

  it('does not restore unchanged old recovery or a different disk baseline', async () => {
    writeAgentDraft({ key: agentDraftKey('proj-1', `file:${PATH}`), dialect: 'agentforce', content: 'stale recovery', baseSha: SHA });
    const el = await open();
    await act(async () => { store.set({ heldBy: FOLLOWER_HELD, doc: docOf() }); });
    const before = localStorage.getItem('salesforce.agent-drafts.v1');
    writeAgentDraft({ key: agentDraftKey('proj-1', 'file:Other.agent'), dialect: 'agentforce', content: 'unrelated edit', baseSha: SHA });
    await act(async () => { window.dispatchEvent(new StorageEvent('storage', { key: 'salesforce.agent-drafts.v1', oldValue: before, newValue: localStorage.getItem('salesforce.agent-drafts.v1') })); });
    docApi.update.mockClear();
    await act(async () => { store.set({ heldBy: null, leased: true, leaseGen: 1, doc: docOf() }); });
    expect(docApi.update).toHaveBeenCalledWith(SOURCE, expect.anything(), SHA);
    await act(async () => { store.set({ heldBy: FOLLOWER_HELD, leased: false }); });
    writeAgentDraft({ key: agentDraftKey('proj-1', `file:${PATH}`), dialect: 'agentforce', content: 'wrong disk base', baseSha: 'b'.repeat(64) });
    docApi.update.mockClear();
    await act(async () => { store.set({ heldBy: null, leased: true, leaseGen: 2, doc: docOf() }); });
    expect(docApi.update).toHaveBeenCalledWith(SOURCE, expect.anything(), SHA);
  });

  it('on gaining the lease it pushes its text when the document is clean or matches', async () => {
    const el = await open();
    docApi.update.mockClear();
    await act(async () => { store.set({ leased: true, leaseGen: 1, doc: docOf() }); });
    await flush();
    expect(docApi.update).toHaveBeenCalledWith(SOURCE, expect.anything(), SHA);
    expect(sent(el).some((m: any) => m.type === 'setReadOnly')).toBe(false);
    docApi.update.mockClear();
    await act(async () => { store.set({ leaseGen: 2, doc: { ...docOf(), dirty: true, text: SOURCE, savedText: 'disk' } }); });
    await flush();
    expect(docApi.update).toHaveBeenCalledWith(SOURCE, expect.anything(), SHA);
  });

  it('never pushes before the frame sent a snapshot for the open agent', async () => {
    store.set({ leased: true, doc: docOf() });
    const el = await mount(PATH); await ready(el);
    expect(docApi.update.mock.calls.filter(c => c[0] === '')).toHaveLength(0);
    expect(docApi.update).not.toHaveBeenCalled();
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0 });
    expect(docApi.update).toHaveBeenCalledWith(SOURCE, undefined, SHA);
  });

  it('identifies the Studio window apart from the project tab, with a per-window client id', async () => {
    await open();
    expect(hook.editor).toEqual({ clientId: 'client-1', label: 'Agentforce Studio' });
    expect(hook.scope).toBe('proj-1|tab');
    nodes.splice(0).forEach(fn => fn());
    surface = 'plugin-view';
    await open();
    expect(hook.editor).toEqual({ clientId: 'client-1', label: 'Agentforce Studio window' });
    expect(hook.scope).toBe('proj-1|window');
  });

  it('keeps one layout key per project and surface, not per thread, seeding the window from the tab', async () => {
    await mount({ subPath: PATH, threadId: 't-1' });
    await mount({ subPath: PATH, threadId: 't-2' });
    const keys = () => Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter(Boolean).filter(k => k.startsWith('salesforce:studio:') && !k.startsWith('salesforce:studio:split:'));
    expect(keys()).toEqual(['salesforce:studio:proj-1']);
    nodes.splice(0).forEach(fn => fn());
    surface = 'plugin-view';
    await mount({ subPath: PATH, threadId: 't-3' });
    expect(keys().sort()).toEqual(['salesforce:studio:proj-1', 'salesforce:studio:proj-1|window']);
  });

  it('does not touch proposals without the lease', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: false, doc: docOf([proposal('p5', 'accept-requested'), proposal('p6', 'pending')]) }); });
    await flush();
    expect(rpc.mock.calls.some(c => c[1] === 'agentFiles.write')).toBe(false);
    expect(sent(el).some((m: any) => m.type === 'proposeEdit')).toBe(false);
  });

  it('resolves the document when the editor accepts or rejects a proposal', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('p7', 'pending')]) }); });
    await flush();
    await post(el, { type: 'proposalResolved', proposalId: 'p7', outcome: 'accepted', acceptedHunks: 1, rejectedHunks: 0, content: 'new text\n', sha256: 'sha9' });
    expect(docApi.resolve).toHaveBeenCalledWith('p7', 'applied', 'sha9');
    await act(async () => { store.set({ doc: docOf([proposal('p8', 'pending')]) }); });
    await flush();
    await post(el, { type: 'proposalResolved', proposalId: 'p8', outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1, content: SOURCE });
    expect(docApi.resolve).toHaveBeenCalledWith('p8', 'reject', undefined);
  });

  it('publishes the editor buffer on the shared document and records the save', async () => {
    const el = await open();
    await post(el, { type: 'snapshot', content: 'edited\n', issues: 0 });
    expect(docApi.update).toHaveBeenCalledWith('edited\n', undefined, SHA);
    await post(el, { type: 'persist', path: PATH, content: 'edited\n' });
    expect(rpc.mock.calls.find(c => c[1] === 'agentFiles.write')?.[2]).toMatchObject({ path: PATH, content: 'edited\n' });
    expect(docApi.saved).toHaveBeenCalledWith('sha2', 'edited\n');
  });
});

describe('AgentScriptPanel shared document: second review fixes', () => {
  const HELD = { id: 'X1', clientId: 'other', label: 'Studio window', since: 1, renewedAt: 1 };
  const OTHER_SHA = 'b'.repeat(64);
  const readOnlyMsgs = (el: HTMLElement) => sent(el).filter((m: any) => m.type === 'setReadOnly');

  it('2: on regaining the lease it pushes its own text over a dirty document it wrote last, or nobody wrote', async () => {
    const el = await open();
    for (const lastWriter of ['client-1', null]) {
      docApi.update.mockClear();
      await act(async () => { store.set({ leased: true, leaseGen: store.state.leaseGen + 1, doc: { ...docOf(), dirty: true, text: 'older text\n', savedText: 'disk\n', lastWriter } }); });
      await flush();
      expect(docApi.update).toHaveBeenCalledWith(SOURCE, expect.anything(), SHA);
      expect(readOnlyMsgs(el)).toHaveLength(0);
      await act(async () => { store.set({ leased: false }); });
    }
  });

  it('3: losing the lease takes shown reviews out of the frame and shows them again once regained', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('q1', 'pending')]) }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'proposeEdit' && m.proposalId === 'q1')).toHaveLength(1);
    await act(async () => { store.set({ leased: false, heldBy: HELD }); });
    await flush();
    expect(sent(el).some((m: any) => m.type === 'clearProposal' && m.proposalId === 'q1')).toBe(true);
    expect(docApi.resolve).not.toHaveBeenCalled(); // it stays pending on the server
    await act(async () => { store.set({ leased: true, heldBy: null, doc: { ...docOf([proposal('q1', 'pending')]), rev: 2 } }); });
    await flush();
    expect(sent(el).filter((m: any) => m.type === 'proposeEdit' && m.proposalId === 'q1')).toHaveLength(2);
  });

  it('3: a command waiting on its review learns the lease moved; a new proposal is refused while another window edits', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf() }); });
    const outcome = await exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, content: 'agent text\n', summary: 'mine' }) as any;
    await flush();
    await act(async () => { store.set({ leased: false, heldBy: HELD }); });
    await flush();
    await expect(outcome.settled).resolves.toMatchObject({ outcome: 'rejected', note: expect.stringContaining('Another Studio window') });
    expect(sent(el).some((m: any) => m.type === 'clearProposal' && m.proposalId === outcome.proposalId)).toBe(true);
    await expect(exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, content: 'again\n', summary: 'x' })).rejects.toThrow('Another Studio window is editing this agent.');
  });

  it('4: a follower does not offer disk changes; unlocking re-baselines the frame on the shared saved version', async () => {
    const el = await open();
    rpc.mockImplementation(async (p, method, args) => method === 'agentFiles.read' ? { ok: true, file: { path: args?.path, content: 'on disk now\n', sha256: OTHER_SHA } } : baseRpc(p, method, args));
    await act(async () => { store.set({ doc: { ...docOf(), dirty: true, text: 'holder\n', savedText: 'on disk now\n', baseSha256: OTHER_SHA }, heldBy: HELD }); });
    await flush();
    const reads = () => rpc.mock.calls.filter(c => c[1] === 'agentFiles.read').length;
    const before = reads();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(reads()).toBe(before);
    expect(sent(el).some((m: any) => m.type === 'fileChanged')).toBe(false);
    await act(async () => { store.set({ heldBy: null, leased: true, leaseGen: 1 }); });
    await flush();
    expect(readOnlyMsgs(el).find((m: any) => m.readOnly === false)).toMatchObject({ baseline: 'on disk now\n', baseSha: OTHER_SHA });
    // Once editing again the disk is watched.
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(reads()).toBeGreaterThan(before);
  });

  it('4: a clean shared document re-baselines on its text; one without a valid base sends no baseline', async () => {
    const el = await open();
    await act(async () => { store.set({ doc: docOf(), heldBy: HELD }); });
    await act(async () => { store.set({ heldBy: null, leased: true }); });
    await flush();
    expect(readOnlyMsgs(el).at(-1)).toMatchObject({ readOnly: false, baseline: SOURCE, baseSha: SHA });
    await act(async () => { store.set({ doc: { ...docOf(), baseSha256: 'nope' }, heldBy: HELD }); });
    await act(async () => { store.set({ heldBy: null, leased: true }); });
    await flush();
    expect('baseline' in readOnlyMsgs(el).at(-1)).toBe(false);
  });

  it('5: an accept it was applying that is settled elsewhere leaves the frame', async () => {
    const el = await open();
    await post(el, { type: 'dirty', dirty: true, draftKey: (sent(el).find((m: any) => m.type === 'setFile') as any).draftKey, baseSha: SHA });
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('w1', 'accept-requested')]) }); });
    await flush();
    expect(sent(el).some((m: any) => m.type === 'proposeEdit' && m.proposalId === 'w1')).toBe(true); // reviewed over unsaved edits
    await act(async () => { store.set({ doc: { ...docOf([proposal('w1', 'rejected')]), rev: 2 } }); });
    await flush();
    expect(sent(el).some((m: any) => m.type === 'clearProposal' && m.proposalId === 'w1')).toBe(true);
    await act(async () => { store.set({ doc: { ...docOf([proposal('w2', 'accept-requested')]), rev: 3 } }); });
    await flush();
    await act(async () => { store.set({ doc: { ...docOf([]), rev: 4 } }); });
    await flush();
    expect(sent(el).some((m: any) => m.type === 'clearProposal' && m.proposalId === 'w2')).toBe(true);
  });

  it('5: an accepted edit written after the person switched agents still records the save and resolves it applied', async () => {
    let release!: () => void;
    rpc.mockImplementation(async (p, method, args) => {
      if (method === 'agentFiles.write' && args?.path === PATH) { await new Promise<void>(r => { release = r; }); return { ok: true, file: { path: PATH, sha256: 'sha2' } }; }
      return baseRpc(p, method, args);
    });
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('s1', 'accept-requested')]) }); });
    await flush();
    await post(el, { type: 'requestOpen', path: 'force-app/bots/Help.agent' });
    await act(async () => { release(); });
    await flush();
    expect(rpc.mock.calls.filter(c => c[1] === 'agentDoc.saved').map(c => c[2])).toEqual([{ path: PATH, clientId: 'client-1', sha256: 'sha2', text: 'new text\n' }]);
    expect(rpc.mock.calls.filter(c => c[1] === 'agentDoc.resolve').map(c => c[2])).toEqual([{ path: PATH, id: 's1', decision: 'applied', clientId: 'client-1', sha256: 'sha2' }]);
    expect(docApi.saved).not.toHaveBeenCalled(); // the hook now points at the other agent
  });

  it('5: a failed write after a switch settles nothing', async () => {
    let release!: () => void;
    rpc.mockImplementation(async (p, method, args) => {
      if (method === 'agentFiles.write' && args?.path === PATH) { await new Promise<void>(r => { release = r; }); return { ok: false, error: 'conflict' }; }
      return baseRpc(p, method, args);
    });
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('s2', 'accept-requested')]) }); });
    await flush();
    await post(el, { type: 'requestOpen', path: 'force-app/bots/Help.agent' });
    await act(async () => { release(); });
    await flush();
    expect(rpc.mock.calls.some(c => c[1] === 'agentDoc.saved' || c[1] === 'agentDoc.resolve')).toBe(false);
  });

  it('7: a draft moved to another base updates the shared document with it', async () => {
    const el = await open();
    docApi.update.mockClear();
    const key = (sent(el).find((m: any) => m.type === 'setFile') as any).draftKey;
    await post(el, { type: 'dirty', dirty: true, draftKey: key, baseSha: OTHER_SHA });
    expect(docApi.update).toHaveBeenCalledWith(SOURCE, expect.anything(), OTHER_SHA);
    docApi.update.mockClear();
    await post(el, { type: 'dirty', dirty: true, draftKey: key, baseSha: OTHER_SHA });
    await post(el, { type: 'dirty', dirty: true, draftKey: 'another-key', baseSha: SHA });
    expect(docApi.update).not.toHaveBeenCalled();
  });

  it('10: drops the per-thread layout keys of pre-release builds once, keeping everything else', async () => {
    const { pruneThreadLayoutKeys, resetThreadLayoutPrune } = await import('./AgentScriptPanel.js');
    resetThreadLayoutPrune();
    localStorage.setItem('salesforce:studio:["proj-1","t1"]', '{}');
    localStorage.setItem('salesforce:studio:split:["proj-1","t1"]', '1');
    localStorage.setItem('salesforce:studio:proj-1', '{}');
    localStorage.setItem('other', 'x');
    await mount(PATH);
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter(Boolean).sort()).toEqual(expect.arrayContaining(['other', 'salesforce:studio:proj-1']));
    expect(Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)!).filter(Boolean).some(k => k.includes('["'))).toBe(false);
    localStorage.setItem('salesforce:studio:["proj-1","t2"]', '{}');
    expect(pruneThreadLayoutKeys()).toBe(0); // once per page
    resetThreadLayoutPrune();
    expect(pruneThreadLayoutKeys(null as never)).toBe(0); // no storage
    expect(pruneThreadLayoutKeys({ length: 1, key: () => { throw Error('denied'); }, removeItem: () => undefined })).toBe(0);
  });
});

describe('AgentScriptPanel shared document: final review fixes', () => {
  const OTHER_SHA = 'b'.repeat(64);
  const shown = (el: HTMLElement) => sent(el).filter((m: any) => m.type === 'proposeEdit').map((m: any) => m.proposalId);
  const draftKey = (el: HTMLElement) => (sent(el).find((m: any) => m.type === 'setFile') as any).draftKey;
  const superseded = (id: string) => ({ type: 'proposalResolved', proposalId: id, outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1, content: SOURCE, note: 'superseded by a newer proposal' });

  it('1: a shared review the frame supersedes is not rejected on the server and is shown again', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('q1', 'pending')]) }); });
    await flush();
    expect(shown(el)).toEqual(['q1']);
    await post(el, superseded('q1'));
    expect(docApi.resolve).not.toHaveBeenCalled();
    expect(shown(el)).toEqual(['q1', 'q1']);
    // A decision the person made in the frame (no note) is resolved as before.
    await post(el, { type: 'proposalResolved', proposalId: 'q1', outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1, content: SOURCE });
    expect(docApi.resolve).toHaveBeenCalledWith('q1', 'reject', undefined);
  });

  it('1: the Studio\'s own command proposal superseded in the frame is still rejected, and its command learns why', async () => {
    const el = await open();
    const outcome = await exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, content: 'agent text\n', summary: 'mine' }) as any;
    await flush();
    await post(el, superseded(outcome.proposalId));
    expect(docApi.resolve).toHaveBeenCalledWith(outcome.proposalId, 'reject', undefined);
    await expect(outcome.settled).resolves.toMatchObject({ outcome: 'rejected', note: 'superseded by a newer proposal' });
  });

  it('1: a shared proposal waits while the Studio\'s own review is open, and an accept over unsaved edits waits its turn', async () => {
    const el = await open();
    await post(el, { type: 'dirty', dirty: true, draftKey: draftKey(el), baseSha: SHA });
    const outcome = await exec('editor.proposeEdit', { path: PATH, expectedSha256: SHA, content: 'agent text\n', summary: 'mine' }) as any;
    await flush();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('q2', 'pending'), proposal('q3', 'accept-requested')]) }); });
    await flush();
    expect(shown(el)).toEqual([outcome.proposalId]); // nothing superseded the open review
    await post(el, { type: 'proposalResolved', proposalId: outcome.proposalId, outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1, content: SOURCE });
    // Once it closes, the next one is shown (in document order); the accept is applied after that.
    expect(shown(el)).toHaveLength(2);
    const next = shown(el)[1];
    await post(el, { type: 'proposalResolved', proposalId: next, outcome: 'rejected', acceptedHunks: 0, rejectedHunks: 1, content: SOURCE });
    expect(shown(el)).toHaveLength(3);
    expect(new Set(shown(el).slice(1))).toEqual(new Set(['q2', 'q3']));
    expect(rpc.mock.calls.some(c => c[1] === 'agentFiles.write')).toBe(false); // the accept is reviewed over the unsaved edits
  });

  it('3: the editor stays a viewer until the frame sent this agent\'s snapshot', async () => {
    const el = await mount(PATH);
    expect(hook.editor).toMatchObject({ clientId: 'client-1', standby: true });
    await ready(el);
    expect(hook.editor).toMatchObject({ standby: true });
    await post(el, { type: 'snapshot', content: SOURCE, issues: 0 });
    expect(hook.editor).toEqual({ clientId: 'client-1', label: 'Agentforce Studio' });
  });

  it('5: an accepted edit whose write throws is rejected with the reason shown', async () => {
    rpc.mockImplementation(async (p, method, args) => { if (method === 'agentFiles.write') throw Error('disk gone'); return baseRpc(p, method, args); });
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('t1', 'accept-requested')]) }); });
    await flush();
    expect(docApi.resolve).toHaveBeenCalledWith('t1', 'reject');
    expect(el.textContent).toContain('Could not apply the accepted edit: disk gone');
  });

  it('6: a proposal written against another version is shown once the editor reaches that version', async () => {
    const el = await open();
    await act(async () => { store.set({ leased: true, doc: docOf([proposal('v1', 'pending', { expectedSha256: OTHER_SHA })]) }); });
    await flush();
    expect(shown(el)).toEqual([]);
    await post(el, { type: 'dirty', dirty: false, draftKey: draftKey(el), baseSha: OTHER_SHA });
    await flush();
    expect(shown(el)).toEqual(['v1']);
  });
});

describe('AgentScriptPanel preview intent', () => {
  const navigate = { openThreadPanel: vi.fn(() => false), toProject: vi.fn() } as any;
  const route = (el: HTMLElement, intent: any) => act(async () => { await routeStudioIntent({ pluginId: 'salesforce', projectId: 'proj-1', threadId: null, intent, from: el.querySelector('[data-testid="salesforce-agent-script-panel"]'), navigate }); });

  it('opens the Preview tab on the stored run and keeps the live Preview mounted behind it', async () => {
    const el = await open();
    await route(el, { kind: 'preview', runId: 'run-9', turn: 2 });
    await flush();
    const view = el.querySelector<HTMLElement>('[data-testid="studio-view-preview"]')!;
    expect(view.style.display).toBe('');
    const replay = view.querySelector('[data-testid="stub-replay"]')!;
    expect([replay.getAttribute('data-run'), replay.getAttribute('data-turn')]).toEqual(['run-9', '2']);
    const live = view.querySelector('[data-testid="stub-preview"]')!;
    expect((live.parentElement as HTMLElement).style.display).toBe('none');
    // A newer card replaces the run; closing it shows the live Preview again.
    await route(el, { kind: 'preview', runId: 'run-10' });
    expect(view.querySelector('[data-testid="stub-replay"]')!.getAttribute('data-run')).toBe('run-10');
    await act(async () => { fireEvent.click(view.querySelector('[data-testid="stub-replay-close"]')!); });
    expect(view.querySelector('[data-testid="stub-replay"]')).toBeNull();
    expect((view.querySelector('[data-testid="stub-preview"]')!.parentElement as HTMLElement).style.display).toBe('contents');
  });

  it('opens a plain Preview without a run, and Tests on the first sub-view for local', async () => {
    const el = await open();
    await route(el, { kind: 'preview' });
    expect(el.querySelector('[data-testid="studio-view-preview"] [data-testid="stub-replay"]')).toBeNull();
    await route(el, { kind: 'tests', sub: 'local' });
    expect(el.querySelector('[data-testid="studio-view-tests"]')).toBeTruthy();
  });
});

describe('native Studio close preflight', () => {
  it('flushes and releases the document before closing local control leases', async () => {
    surface = 'plugin-view'; resourceId = PATH;
    await open();
    expect(control.closeHandler).toBeTypeOf('function');
    let finish!: () => void;
    docApi.release.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const closing = control.closeHandler!(new AbortController().signal);
    expect(closeControls).not.toHaveBeenCalled();
    finish();
    await closing;
    expect(closeControls).toHaveBeenCalledWith('proj-1');
  });
  it('keeps control routing alive when document release rejects', async () => {
    surface = 'plugin-view'; resourceId = PATH;
    await open();
    await act(async () => { store.set({ leased: true }); });
    docApi.release.mockRejectedValueOnce(Error('Draft flush failed'));
    await expect(control.closeHandler!(new AbortController().signal)).rejects.toThrow('Draft flush failed');
    expect(closeControls).not.toHaveBeenCalled();
    expect(docApi.resume).not.toHaveBeenCalled();
  });
  it('does not install native close preflight for the main Studio', async () => {
    await open();
    expect(control.closeHandler).toBeNull();
  });
});

it('reopens the editor after control-close refusal and after native-close timeout', async () => {
  surface = 'plugin-view'; resourceId = PATH;
  const el = await open();
  closeControls.mockRejectedValueOnce(Error('Control unavailable'));
  await act(async () => { await expect(control.closeHandler!(new AbortController().signal)).rejects.toThrow('Control unavailable'); });
  expect(docApi.resume).toHaveBeenCalledTimes(1);
  expect(sent(el).some(message => message.type === 'setReadOnly' && message.readOnly)).toBe(true);
  const aborted = new AbortController(); aborted.abort();
  await act(async () => { await expect(control.closeHandler!(aborted.signal)).rejects.toBeDefined(); });
  expect(docApi.resume).toHaveBeenCalledTimes(2);
});


describe('native agent window ownership', () => {
  it('shows the matching detached owner and can focus it again', async () => {
    const openWindow = vi.spyOn(windowRoute, 'openAgentInStudioWindow').mockResolvedValue(true);
    navigation.openInWindow = vi.fn();
    rpc.mockImplementation(async (plugin, method, args) => method === 'control.views' ? { ok: true, views: [
      { window: 'project', surface: 'workbench', state: { resourceId: PATH } },
      { window: 'plugin-view', surface: 'other', state: { resourceId: PATH } },
      { window: 'plugin-view', surface: 'workbench', state: { resourceId: 'force-app/Other.agent' } },
      { window: 'plugin-view', surface: 'workbench', state: { resourceId: PATH } }
    ] } : baseRpc(plugin, method, args));
    const el = await open();
    const banner = el.querySelector('[data-testid="salesforce-agent-detached-banner"]');
    expect(banner?.textContent).toContain('Editing this agent in its own window');
    await act(async () => { fireEvent.click(banner!.querySelector('button')!); });
    expect(openWindow).toHaveBeenCalledWith(expect.objectContaining({ path: PATH, projectId: 'proj-1' }));
    expect(docApi.release).toHaveBeenCalledOnce();
  });
  it('serializes detach requests and restores the workspace on open refusal', async () => {
    navigation.openInWindow = vi.fn();
    let finish!: (value: boolean) => void;
    const openWindow = vi.spyOn(windowRoute, 'openAgentInStudioWindow').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    rpc.mockImplementation(async (plugin, method, args) => method === 'control.views' ? { ok: true, views: [] } : baseRpc(plugin, method, args));
    const el = await open();
    const detach = el.querySelector('[aria-label="Open QC.agent in its own window"]')!;
    await act(async () => { fireEvent.click(detach); await Promise.resolve(); fireEvent.click(detach); });
    expect(openWindow).toHaveBeenCalledOnce();
    await act(async () => { finish(false); });
    expect(el.textContent).toContain('Could not open the agent window. Your workspace remains here.');
    expect(el.querySelector('[data-testid="salesforce-agent-detached-banner"]')).toBeNull();
  });
  it.each([Error('Cannot flush draft'), 'Connection lost'])('keeps the workspace when detaching throws (%s)', async failure => {
    navigation.openInWindow = vi.fn();
    vi.spyOn(windowRoute, 'openAgentInStudioWindow').mockRejectedValueOnce(failure);
    const el = await open();
    await act(async () => { fireEvent.click(el.querySelector('[aria-label="Open QC.agent in its own window"]')!); });
    expect(el.textContent).toContain(failure instanceof Error ? failure.message : failure);
    expect(el.querySelector('[data-testid="salesforce-agent-detached-banner"]')).toBeNull();
  });
  it('refuses retargeting a resource window when another agent cannot open', async () => {
    surface = 'plugin-view'; resourceId = PATH;
    const openWindow = vi.spyOn(windowRoute, 'openAgentInStudioWindow').mockResolvedValue(false);
    const el = await open();
    await act(async () => { await expect(exec('file.open', { path: 'force-app/bots/Help.agent' })).rejects.toThrow('Could not open'); });
    await flush();
    expect(openWindow).toHaveBeenCalledWith(expect.objectContaining({ path: 'force-app/bots/Help.agent' }));
    expect(el.textContent).toContain('Could not open the agent window. Try again from the main Studio.');
    expect(el.querySelector('.af-document-name')?.textContent).toBe('QC.agent');
  });
});
