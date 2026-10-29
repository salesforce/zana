/** @vitest-environment happy-dom */
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentDocSnapshot } from '../../../lib/agent-doc-contract.js';
import { AGENT_DOC_LAPSE_CHECK_MS, newAgentDocClientId, stableAgentDocClientId, useAgentScriptDoc, type AgentScriptDocApi } from './useAgentScriptDoc.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rpc = vi.fn();
let realtime: ((p: unknown) => void) | undefined;
vi.mock('@zana-ai/zcc-plugin-sdk/app', () => ({
  callPluginRpc: (...a: unknown[]) => rpc(...a),
  useRealtime: (_c: string, h: (p: unknown) => void) => { realtime = h; }
}));

const ME = { clientId: 'me', label: 'Studio' };
const snap = (o: Partial<AgentDocSnapshot> = {}): AgentDocSnapshot => ({
  projectId: 'p', path: 'a.agent', rev: 1, text: 'v1', baseSha256: 's', savedText: null, dirty: false,
  diagnostics: [], lease: null, proposals: [], updatedAt: 1, ...o
});
const mine = { id: 'L1', clientId: 'me', label: 'Studio', since: 1, renewedAt: 1 };
const other = { id: 'X1', clientId: 'x', label: 'Other', since: 1, renewedAt: 1 };
const ok = (doc: AgentDocSnapshot, extra: object = {}) => ({ ok: true, doc, ...extra });
const methods = () => rpc.mock.calls.map(c => c[1]);
const callsOf = (m: string) => rpc.mock.calls.filter(c => c[1] === m).map(c => c[2]);

let api: AgentScriptDocApi;
function Probe(props: { pluginId?: string; projectId: string | null; path: string | null; editor?: { clientId: string; label: string; standby?: boolean } }) {
  api = useAgentScriptDoc(props.pluginId ?? 'sf', props.projectId, props.path, props.editor ? { editor: props.editor } : undefined);
  return null;
}
const tick = (ms = 1) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** Default server: open returns the doc, lease grants. */
function server(state: { doc: AgentDocSnapshot }) {
  rpc.mockImplementation(async (_id, method, input) => {
    if (method === 'agentDoc.open') return ok(state.doc);
    if (method === 'agentDoc.lease') { state.doc = { ...state.doc, rev: state.doc.rev + 1, lease: mine }; return ok(state.doc); }
    if (method === 'agentDoc.update') { state.doc = { ...state.doc, rev: state.doc.rev + 1, text: input.text }; return ok(state.doc); }
    return ok(state.doc);
  });
}

beforeEach(() => { vi.useFakeTimers(); rpc.mockReset(); realtime = undefined; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('viewer mode', () => {
  it('routes shared drafts and pending cleanup through their captured project after a project switch', async () => {
    const documents = new Map<string, AgentDocSnapshot>();
    rpc.mockImplementation(async (_id, method, input) => {
      if (!input.projectId) return { ok: false, code: 'project_required', error: 'Choose a registered project.' };
      let doc = documents.get(input.projectId) ?? snap({ projectId: input.projectId });
      if (method === 'agentDoc.lease') doc = { ...doc, lease: mine, rev: doc.rev + 1 };
      if (method === 'agentDoc.update') doc = { ...doc, text: input.text, rev: doc.rev + 1 };
      documents.set(input.projectId, doc);
      return ok(doc);
    });
    const view = render(<Probe projectId="p" path="a.agent" />); await tick();
    expect(api.doc?.projectId).toBe('p'); expect(api.error).toBeNull();
    view.rerender(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    act(() => api.update('saved debounce')); await tick(400);
    act(() => api.update('last pending keystrokes'));
    view.rerender(<Probe projectId="q" path="a.agent" editor={ME} />); await tick();
    expect(api.doc?.projectId).toBe('q'); expect(api.leased).toBe(true);
    expect(callsOf('agentDoc.update')).toEqual([
      expect.objectContaining({ projectId: 'p', text: 'saved debounce' }),
      expect.objectContaining({ projectId: 'p', text: 'last pending keystrokes' })
    ]);
    expect(callsOf('agentDoc.close')).toEqual([expect.objectContaining({ projectId: 'p', path: 'a.agent' })]);
    expect(callsOf('agentDoc.open').map(input => input.projectId)).toEqual(['p', 'p', 'q']);
    expect(callsOf('agentDoc.lease').map(input => input.projectId)).toEqual(['p', 'q']);
    view.unmount(); await tick();
    expect(callsOf('agentDoc.close').at(-1)).toMatchObject({ projectId: 'q', path: 'a.agent' });
  });

  it('does nothing without project or path', async () => {
    render(<Probe projectId={null} path="a.agent" />); await tick();
    expect(api.doc).toBeNull(); expect(api.loading).toBe(false); expect(rpc).not.toHaveBeenCalled();
    render(<Probe projectId="p" path={null} />); await tick();
    expect(rpc).not.toHaveBeenCalled();
    expect(await api.takeOver()).toBe(false);
    expect(await api.propose({ path: 'a', expectedSha256: 's', summary: '' })).toBeNull();
    expect(await api.resolve('1', 'reject')).toEqual({ ok: false, error: 'No document is open.' });
    await api.saved('s', 't'); api.update('x'); api.reload();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('opens, exposes the doc and a foreign lease, and never leases or closes', async () => {
    server({ doc: snap({ lease: other }) });
    const view = render(<Probe projectId="p" path="a.agent" />); await tick();
    expect(rpc).toHaveBeenCalledWith('sf', 'agentDoc.open', { projectId: 'p', path: 'a.agent' });
    expect(api.doc?.text).toBe('v1'); expect(api.loading).toBe(false); expect(api.heldBy).toEqual(other); expect(api.leased).toBe(false);
    api.update('ignored'); await tick(1000);
    expect(methods()).toEqual(['agentDoc.open']);
    view.unmount(); expect(methods()).toEqual(['agentDoc.open']);
  });

  it('surfaces open failures and thrown RPCs without throwing', async () => {
    rpc.mockResolvedValueOnce({ ok: false, code: 'bad', error: 'nope' });
    render(<Probe projectId="p" path="a.agent" />); await tick();
    expect(api.error).toBe('nope'); expect(api.doc).toBeNull();
    rpc.mockRejectedValueOnce(new Error('boom')); await act(async () => { api.reload(); await vi.advanceTimersByTimeAsync(1); });
    expect(api.error).toBe('boom');
    rpc.mockRejectedValueOnce('str'); await act(async () => { api.reload(); await vi.advanceTimersByTimeAsync(1); });
    expect(api.error).toBe('str');
    rpc.mockResolvedValueOnce(undefined); await act(async () => { api.reload(); await vi.advanceTimersByTimeAsync(1); });
    expect(api.error).toBe('Unexpected response.');
    rpc.mockResolvedValueOnce({ ok: false }); await act(async () => { api.reload(); await vi.advanceTimersByTimeAsync(1); });
    expect(api.error).toBe('Request failed.');
    rpc.mockResolvedValueOnce(ok(snap())); await act(async () => { api.reload(); await vi.advanceTimersByTimeAsync(1); });
    expect(api.error).toBeNull(); expect(api.doc?.rev).toBe(1);
  });

  it('ignores a response from the previous path (race guard)', async () => {
    let releaseA!: (v: unknown) => void;
    rpc.mockImplementation((_id, method, input) => input.path === 'a.agent'
      ? new Promise(r => { releaseA = r; })
      : Promise.resolve(ok(snap({ path: 'b.agent', text: 'B' }))));
    const view = render(<Probe projectId="p" path="a.agent" />);
    view.rerender(<Probe projectId="p" path="b.agent" />); await tick();
    expect(api.doc?.text).toBe('B');
    await act(async () => { releaseA(ok(snap({ text: 'A', rev: 9 }))); await vi.advanceTimersByTimeAsync(1); });
    expect(api.doc?.text).toBe('B');
  });

  it('clears the doc when the path goes null', async () => {
    server({ doc: snap() });
    const view = render(<Probe projectId="p" path="a.agent" />); await tick();
    view.rerender(<Probe projectId="p" path={null} />); await tick();
    expect(api.doc).toBeNull();
  });

  it('propose / resolve / saved return results and adopt snapshots', async () => {
    server({ doc: snap() });
    render(<Probe projectId="p" path="a.agent" />); await tick();
    const proposal = { id: 'q', input: { path: 'a.agent', expectedSha256: 's', summary: 'x' }, status: 'pending', createdAt: 1 };
    rpc.mockResolvedValueOnce(ok(snap({ rev: 2, proposals: [proposal as any] }), { proposal }));
    let got: unknown; await act(async () => { got = await api.propose(proposal.input, { id: 'q', threadId: 't' }); });
    expect(got).toBe(proposal); expect(api.doc?.proposals).toHaveLength(1);
    expect(callsOf('agentDoc.propose')[0]).toEqual({ projectId: 'p', path: 'a.agent', input: proposal.input, id: 'q', threadId: 't' });
    // proposal falls back to the doc's list
    rpc.mockResolvedValueOnce(ok(snap({ rev: 3, proposals: [proposal as any] })));
    await act(async () => { got = await api.propose(proposal.input, { id: 'q' }); });
    expect(got).toBe(proposal);
    rpc.mockResolvedValueOnce(ok(snap({ rev: 4 })));
    await act(async () => { got = await api.propose(proposal.input); });
    expect(got).toBeNull();
    rpc.mockResolvedValueOnce({ ok: false, code: 'x', error: 'cap' });
    await act(async () => { got = await api.propose(proposal.input); });
    expect(got).toBeNull(); expect(api.error).toBe('cap');

    rpc.mockResolvedValueOnce(ok(snap({ rev: 5 })));
    await act(async () => { got = await api.resolve('q', 'accept', 'sha'); });
    expect(got).toEqual({ ok: true }); expect(api.doc?.rev).toBe(5);
    expect(callsOf('agentDoc.resolve')[0]).toEqual({ projectId: 'p', path: 'a.agent', id: 'q', decision: 'accept', sha256: 'sha' });
    rpc.mockResolvedValueOnce({ ok: false, code: 'conflict', error: 'changed' });
    await act(async () => { got = await api.resolve('q', 'reject'); });
    expect(got).toEqual({ ok: false, error: 'changed', code: 'conflict' });

    rpc.mockResolvedValueOnce(ok(snap({ rev: 6, text: 'T' })));
    await act(async () => { await api.saved('sha', 'T'); });
    expect(api.doc?.text).toBe('T'); expect(callsOf('agentDoc.saved')[0]).toEqual({ projectId: 'p', path: 'a.agent', clientId: '', sha256: 'sha', text: 'T' });
    rpc.mockResolvedValueOnce({ ok: false, code: 'x', error: 'save failed' });
    await act(async () => { await api.saved('sha', 'T'); });
    expect(api.error).toBe('save failed');
    expect(await api.takeOver()).toBe(false); // viewers cannot take over
  });

  it('does not apply an older snapshot over a newer one', async () => {
    server({ doc: snap({ rev: 5 }) });
    render(<Probe projectId="p" path="a.agent" />); await tick();
    rpc.mockResolvedValueOnce(ok(snap({ rev: 3, text: 'old' })));
    await act(async () => { api.reload(); await vi.advanceTimersByTimeAsync(1); });
    expect(api.doc?.rev).toBe(5);
  });
});

describe('realtime', () => {
  it('reopens only for this project+path with a newer rev', async () => {
    const state = { doc: snap({ rev: 2 }) }; server(state);
    render(<Probe projectId="p" path="a.agent" />); await tick();
    const n = () => callsOf('agentDoc.open').length;
    const base = n();
    for (const ev of [null, 'x', { projectId: 'q', path: 'a.agent', rev: 9 }, { projectId: 'p', path: 'b.agent', rev: 9 },
      { projectId: 'p', path: 'a.agent', rev: 2 }, { projectId: 'p', path: 'a.agent', rev: 'z' }]) {
      await act(async () => { realtime!(ev); await vi.advanceTimersByTimeAsync(1); });
    }
    expect(n()).toBe(base);
    state.doc = snap({ rev: 3, text: 'remote' });
    await act(async () => { realtime!({ projectId: 'p', path: 'a.agent', rev: 3, kind: 'text' }); await vi.advanceTimersByTimeAsync(1); });
    expect(n()).toBe(base + 1); expect(api.doc?.text).toBe('remote');
    state.doc = snap({ rev: 4, text: 'gone' });
    await act(async () => { realtime!({ projectId: 'p', path: 'a.agent', rev: 4, kind: 'closed' }); await vi.advanceTimersByTimeAsync(1); });
    expect(api.doc?.rev).toBe(4);
  });

  it('ignores events while no path is open', async () => {
    render(<Probe projectId="p" path={null} />); await tick();
    await act(async () => { realtime!({ projectId: 'p', path: null, rev: 1 }); });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('editor mode', () => {
  it('leases after open, renews every 15 s, closes on unmount', async () => {
    server({ doc: snap() });
    const view = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    expect(methods().slice(0, 2)).toEqual(['agentDoc.open', 'agentDoc.lease']);
    expect(callsOf('agentDoc.lease')[0]).toEqual({ projectId: 'p', path: 'a.agent', clientId: 'me', label: 'Studio' });
    expect(api.leased).toBe(true); expect(api.heldBy).toBeNull();
    await tick(15_000); expect(callsOf('agentDoc.lease')).toHaveLength(2);
    await tick(15_000); expect(callsOf('agentDoc.lease')).toHaveLength(3);
    view.unmount();
    expect(callsOf('agentDoc.close')).toEqual([{ projectId: 'p', path: 'a.agent', clientId: 'me', leaseId: 'L1' }]);
    await tick(30_000); expect(callsOf('agentDoc.lease')).toHaveLength(3);
  });

  it('closes the previous path when the path changes', async () => {
    server({ doc: snap() });
    const view = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    view.rerender(<Probe projectId="p" path="b.agent" editor={ME} />); await tick();
    expect(callsOf('agentDoc.close')).toEqual([{ projectId: 'p', path: 'a.agent', clientId: 'me', leaseId: 'L1' }]);
    expect(callsOf('agentDoc.open').map(c => c.path)).toEqual(['a.agent', 'b.agent']);
  });

  it('denial exposes heldBy and stays read-only; take over wins the lease', async () => {
    let held = true;
    rpc.mockImplementation(async (_id, method, input) => {
      if (method === 'agentDoc.open') return ok(snap({ lease: held ? other : mine }));
      if (method === 'agentDoc.lease') {
        if (held && !input.take) return { ok: false, code: 'leased', error: 'held' };
        held = false; return ok(snap({ rev: 2, lease: mine }));
      }
      return ok(snap());
    });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    expect(api.leased).toBe(false); expect(api.heldBy).toEqual(other); expect(api.error).toBeNull();
    api.update('x'); await tick(1000);
    expect(callsOf('agentDoc.update')).toHaveLength(0);
    let won = false; await act(async () => { won = await api.takeOver(); });
    expect(won).toBe(true); expect(api.leased).toBe(true); expect(api.heldBy).toBeNull();
    expect(callsOf('agentDoc.lease').at(-1)).toMatchObject({ take: true });
  });

  it('failed take over reports false and the error', async () => {
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.open' ? ok(snap({ lease: other })) : { ok: false, code: 'boom', error: 'denied' });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    expect(api.error).toBe('denied');
    let won = true; await act(async () => { won = await api.takeOver(); });
    expect(won).toBe(false);
  });

  it('loses the lease when a reopened doc is held by someone else; renewals never take it, a freed one is re-acquired', async () => {
    const state = { doc: snap() }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    expect(api.leased).toBe(true);
    state.doc = snap({ rev: 20, lease: other });
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.lease' ? { ok: false, code: 'leased', error: 'held', doc: state.doc } : ok(state.doc));
    await act(async () => { realtime!({ projectId: 'p', path: 'a.agent', rev: 20, kind: 'lease' }); await vi.advanceTimersByTimeAsync(1); });
    expect(api.leased).toBe(false); expect(api.heldBy).toEqual(other);
    await tick(30_000);
    // Each tick asks again, never with take, naming the grant it lost.
    expect(callsOf('agentDoc.lease').slice(-2)).toEqual([0, 1].map(() => ({ projectId: 'p', path: 'a.agent', clientId: 'me', label: 'Studio', leaseId: 'L1' })));
    expect(api.leased).toBe(false); expect(api.heldBy).toEqual(other); expect(api.error).toBeNull();
  });

  it('a renewal asks for the lease without take, keeps it on transient failures and flags text that changed under a lapsed lease', async () => {
    const state = { doc: snap() }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    const gen = api.leaseGen; expect(gen).toBeGreaterThan(0);
    await tick(15_000);
    expect(callsOf('agentDoc.lease').at(-1)).toEqual({ projectId: 'p', path: 'a.agent', clientId: 'me', label: 'Studio', leaseId: 'L1' });
    expect(api.leaseGen).toBe(gen); // a plain renewal is not a regain
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.lease' ? { ok: false, code: 'boom', error: 'offline' } : ok(state.doc));
    await tick(15_000);
    expect(api.leased).toBe(true);
    // A renewal of the same grant whose text moved (our own debounced update landed): not a regain.
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.lease' ? ok(snap({ rev: 80, lease: mine, text: 'own edit' })) : ok(state.doc));
    await tick(15_000);
    expect(api.leaseGen).toBe(gen);
    // The lease lapsed and the renewal was a new grant: the editor must reconcile.
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.lease' ? ok(snap({ rev: 90, lease: { ...mine, id: 'L2' }, text: 'changed by another' })) : ok(state.doc));
    await tick(15_000);
    expect(api.leased).toBe(true); expect(api.leaseGen).toBe(gen + 1); expect(api.doc?.text).toBe('changed by another');
    await tick(15_000);
    expect(callsOf('agentDoc.lease').at(-1)).toMatchObject({ leaseId: 'L2' });
  });

  it('a renewal denied by a new holder flips leased off', async () => {
    const state = { doc: snap() }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.lease' ? { ok: false, code: 'leased', error: 'x' } : ok(snap({ rev: 30, lease: other })));
    await tick(15_000);
    expect(api.leased).toBe(false); expect(api.heldBy).toEqual(other);
  });

  it('update debounces, coalesces to the latest text and sends the current rev', async () => {
    const state = { doc: snap() }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    const rev = api.doc!.rev;
    api.update('a'); await tick(100); api.update('ab'); await tick(100); api.update('abc');
    expect(callsOf('agentDoc.update')).toHaveLength(0);
    await tick(300);
    expect(callsOf('agentDoc.update')).toEqual([{ projectId: 'p', path: 'a.agent', clientId: 'me', label: 'Studio', leaseId: 'L1', rev, text: 'abc' }]);
    expect(api.doc?.text).toBe('abc');
  });

  it('skips unchanged text, sends diagnostics-only changes, keeps earlier diagnostics', async () => {
    const state = { doc: snap({ text: 'same' }) }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    api.update('same'); await tick(400);
    expect(callsOf('agentDoc.update')).toHaveLength(0);
    api.update('same', []); await tick(400);
    expect(callsOf('agentDoc.update')).toHaveLength(0);
    const d = [{ line: 1, column: 1, endLine: 1, endColumn: 2, severity: 'error' as const, message: 'm' }];
    api.update('same', d); await tick(400);
    expect(callsOf('agentDoc.update')).toHaveLength(1);
    expect(callsOf('agentDoc.update')[0].diagnostics).toEqual(d);
    api.update('next', d); api.update('next2'); await tick(400); // diagnostics carried forward
    expect(callsOf('agentDoc.update')[1]).toMatchObject({ text: 'next2', diagnostics: d });
  });

  it('retries once on stale after re-opening, using the new rev', async () => {
    const state = { doc: snap() }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    let first = true;
    rpc.mockImplementation(async (_id, method, input) => {
      if (method === 'agentDoc.update') {
        if (first) { first = false; return { ok: false, code: 'stale', error: 'stale' }; }
        return ok(snap({ rev: input.rev + 1, text: input.text, lease: mine }));
      }
      if (method === 'agentDoc.open') return ok(snap({ rev: 50, text: 'remote', lease: mine }));
      return ok(state.doc);
    });
    api.update('mine'); await tick(400);
    const ups = callsOf('agentDoc.update');
    expect(ups).toHaveLength(2); expect(ups[1].rev).toBe(50);
    expect(api.doc).toMatchObject({ rev: 51, text: 'mine' }); expect(api.error).toBeNull();
  });

  it('gives up after a second stale and reports the error', async () => {
    const state = { doc: snap() }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.update' ? { ok: false, code: 'stale', error: 'still stale' } : ok(snap({ rev: 50, lease: mine })));
    api.update('mine'); await tick(400);
    expect(callsOf('agentDoc.update')).toHaveLength(2);
    expect(api.error).toBe('still stale');
  });

  it('a leased failure on update drops the lease', async () => {
    server({ doc: snap() });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.update' ? { ok: false, code: 'leased', error: 'taken' } : ok(snap({ rev: 9, lease: other })));
    api.update('x'); await tick(400);
    expect(api.leased).toBe(false); expect(api.error).toBe('taken');
  });

  it('sends edits made while a request is in flight afterwards', async () => {
    const state = { doc: snap() }; server(state);
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    let release!: () => void;
    rpc.mockImplementation(async (_id, method, input) => {
      if (method !== 'agentDoc.update') return ok(state.doc);
      if (input.text === 'one') await new Promise<void>(r => { release = r; });
      state.doc = { ...state.doc, rev: state.doc.rev + 1, text: input.text }; return ok(state.doc);
    });
    api.update('one'); await tick(400);
    api.update('two'); await tick(400);
    expect(callsOf('agentDoc.update').map(c => c.text)).toEqual(['one']);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(400); });
    expect(callsOf('agentDoc.update').map(c => c.text)).toEqual(['one', 'two']);
  });

  it('flushes a debounced update on unmount (an agent switch) before releasing the lease', async () => {
    server({ doc: snap() });
    const view = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    api.update('late'); view.unmount(); await tick(1000);
    const names = methods().filter(m => m === 'agentDoc.update' || m === 'agentDoc.close');
    expect(names).toEqual(['agentDoc.update', 'agentDoc.close']);
    expect(callsOf('agentDoc.update')[0]).toMatchObject({ clientId: 'me', label: 'Studio', rev: 2, text: 'late' });
  });

  it('waits for an in-flight update before flushing the final edit and closing on an agent switch', async () => {
    const state = { doc: snap() }; server(state);
    const view = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    let finishUpdate!: () => void;
    rpc.mockImplementation(async (_id, method, input) => {
      if (method === 'agentDoc.update') {
        if (input.text === 'first') await new Promise<void>(resolve => { finishUpdate = resolve; });
        if (input.rev !== state.doc.rev) return { ok: false, code: 'stale', error: 'stale', doc: state.doc };
        state.doc = { ...state.doc, rev: state.doc.rev + 1, text: input.text };
      }
      return ok(state.doc);
    });
    api.update('first'); await tick(300);
    api.update('final');
    // A page close followed by component cleanup must share the same final flush.
    window.dispatchEvent(new Event('pagehide'));
    view.unmount();
    expect(callsOf('agentDoc.update')).toHaveLength(1);
    expect(callsOf('agentDoc.close')).toHaveLength(0);
    await act(async () => { finishUpdate(); await vi.advanceTimersByTimeAsync(1_000); });
    expect(state.doc.text).toBe('final');
    expect(callsOf('agentDoc.update').map(call => call.rev)).toEqual([2, 3]);
    expect(callsOf('agentDoc.close')).toHaveLength(1);
  });

  it('does not send an update on unmount when nothing is pending, or after the lease was lost', async () => {
    server({ doc: snap() });
    const idle = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    idle.unmount(); await tick(1000);
    expect(callsOf('agentDoc.update')).toHaveLength(0); expect(callsOf('agentDoc.close')).toHaveLength(1);
    rpc.mockReset();
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.lease' ? { ok: false, code: 'leased', error: 'held' } : ok(snap({ lease: other })));
    const held = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    api.update('x'); held.unmount(); await tick(1000);
    expect(callsOf('agentDoc.update')).toHaveLength(0);
  });

  it('releases the lease when the page hides', async () => {
    server({ doc: snap() });
    const view = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    window.dispatchEvent(new Event('pagehide'));
    expect(callsOf('agentDoc.close')).toEqual([{ projectId: 'p', path: 'a.agent', clientId: 'me', leaseId: 'L1' }]);
    view.unmount(); rpc.mockClear(); window.dispatchEvent(new Event('pagehide'));
    expect(callsOf('agentDoc.close')).toHaveLength(0); // listener removed
  });

  it('a viewer never listens for pagehide', async () => {
    server({ doc: snap() });
    render(<Probe projectId="p" path="a.agent" />); await tick();
    window.dispatchEvent(new Event('pagehide'));
    expect(callsOf('agentDoc.close')).toHaveLength(0);
  });

  it('resolve surfaces the failure code', async () => {
    server({ doc: snap() });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    rpc.mockImplementation(async () => ({ ok: false, code: 'conflict', error: 'moved' }));
    let out: unknown; await act(async () => { out = await api.resolve('q', 'accept', 'sha'); });
    expect(out).toEqual({ ok: false, error: 'moved', code: 'conflict' });
  });

  it('saved and resolve pass the editor clientId', async () => {
    server({ doc: snap() });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    await act(async () => { await api.saved('sha', 'T'); await api.resolve('q', 'applied', 'sha2'); });
    expect(callsOf('agentDoc.saved')[0]).toMatchObject({ clientId: 'me' });
    expect(callsOf('agentDoc.resolve')[0]).toEqual({ projectId: 'p', path: 'a.agent', id: 'q', decision: 'applied', clientId: 'me', sha256: 'sha2' });
  });

  it('does not lease when the open itself failed', async () => {
    rpc.mockResolvedValue({ ok: false, code: 'bad', error: 'no' });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    expect(callsOf('agentDoc.lease')).toHaveLength(0); expect(api.error).toBe('no');
  });
});

describe('second review fixes', () => {
  const event = (rev: number) => act(async () => { realtime!({ projectId: 'p', path: 'a.agent', rev, kind: 'lease' }); await vi.advanceTimersByTimeAsync(1); });
  /** A server with one grant counter: every grant is a new id; a lease call naming the live grant renews it. */
  function leaseServer(start: Partial<AgentDocSnapshot> = {}) {
    let grants = 0;
    const state = { doc: snap(start) };
    rpc.mockImplementation(async (_id, method, input) => {
      if (method === 'agentDoc.open') return ok(state.doc);
      if (method === 'agentDoc.lease') {
        const lease = state.doc.lease;
        if (lease && !(lease.clientId === input.clientId && (input.leaseId === lease.id || input.leaseId === undefined)) && !input.take) return { ok: false, code: 'leased', error: 'held', doc: state.doc };
        if (!lease || lease.id !== input.leaseId) state.doc = { ...state.doc, rev: state.doc.rev + 1, lease: { ...mine, clientId: input.clientId, id: `G${++grants}` } };
        return ok(state.doc);
      }
      if (method === 'agentDoc.update') { state.doc = { ...state.doc, rev: state.doc.rev + 1, text: input.text, lastWriter: input.clientId }; return ok(state.doc); }
      return ok(state.doc);
    });
    return state;
  }

  it('1: re-acquires (never takes) when a reopened document has no lease: plugin restart, holder closed', async () => {
    const state = leaseServer();
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    expect(api.leased).toBe(true); const gen = api.leaseGen;
    // The plugin restarted: the rebuilt document has no lease.
    state.doc = snap({ rev: 40 });
    await event(40);
    expect(api.leased).toBe(true); expect(api.leaseGen).toBe(gen + 1);
    expect(callsOf('agentDoc.lease').at(-1)).toEqual({ projectId: 'p', path: 'a.agent', clientId: 'me', label: 'Studio', leaseId: 'G1' });
    // Window B takes over, then closes.
    state.doc = { ...state.doc, rev: 50, lease: other };
    await event(50);
    expect(api.leased).toBe(false); expect(api.heldBy).toEqual(other);
    api.update('ignored'); await tick(400); expect(callsOf('agentDoc.update')).toHaveLength(0);
    state.doc = { ...state.doc, rev: 60, lease: null };
    await event(60);
    expect(api.leased).toBe(true); expect(api.heldBy).toBeNull(); expect(api.leaseGen).toBe(gen + 2);
    expect(callsOf('agentDoc.lease').every(c => !c.take)).toBe(true);
    api.update('mine'); await tick(400); expect(callsOf('agentDoc.update').at(-1)).toMatchObject({ text: 'mine', leaseId: 'G3' });
  });

  it('1: a renewal that finds the lease lapsed is a new grant; the tick also retries after a failed first request', async () => {
    const state = leaseServer();
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    const gen = api.leaseGen;
    state.doc = { ...state.doc, lease: null }; // lapsed server-side, no event
    await tick(15_000);
    expect(api.leased).toBe(true); expect(api.leaseGen).toBe(gen + 1);
  });

  it('1: an acquire failure that carries a lease-free document does not loop', async () => {
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.open' ? ok(snap()) : { ok: false, code: 'too_many_open', error: 'full', doc: snap({ rev: 2 }) });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick(100);
    expect(callsOf('agentDoc.lease').length).toBeLessThanOrEqual(2);
    expect(api.error).toBe('full'); expect(api.leased).toBe(false);
  });

  it('6: a fresh session asks without a grant id; the old session closes with its own grant only', async () => {
    const state = leaseServer();
    const first = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    first.unmount();
    expect(callsOf('agentDoc.close').at(-1)).toEqual({ projectId: 'p', path: 'a.agent', clientId: 'me', leaseId: 'G1' });
    state.doc = { ...state.doc, lease: { ...mine, id: 'G1' } }; // the close has not landed yet
    rpc.mockClear();
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    expect(callsOf('agentDoc.lease')[0]).toEqual({ projectId: 'p', path: 'a.agent', clientId: 'me', label: 'Studio' });
    // Before its first request the old grant in this client's name is not shown as someone else's.
    expect(api.leased).toBe(true); expect(api.heldBy).toBeNull();
  });

  it('6: a session that never held a grant closes with an empty grant id', async () => {
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.lease' ? { ok: false, code: 'leased', error: 'held' } : ok(snap({ lease: other })));
    const view = render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    view.unmount();
    expect(callsOf('agentDoc.close')).toEqual([{ projectId: 'p', path: 'a.agent', clientId: 'me', leaseId: '' }]);
  });

  it('6: a lease of this client under another grant (a duplicated window) is shown as held, not ours', async () => {
    const state = leaseServer();
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    state.doc = { ...state.doc, rev: 70, lease: { ...mine, id: 'TWIN' } };
    await event(70);
    expect(api.leased).toBe(false); expect(api.heldBy).toMatchObject({ id: 'TWIN' });
    await tick(15_000);
    expect(callsOf('agentDoc.lease').at(-1)).toMatchObject({ leaseId: 'G1' });
    expect(api.leased).toBe(false);
  });

  it('2: pagehide sends the pending debounced edit before closing', async () => {
    leaseServer();
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    api.update('typed', undefined, 'b'.repeat(64));
    window.dispatchEvent(new Event('pagehide'));
    await tick(1);
    const names = methods().filter(m => m === 'agentDoc.update' || m === 'agentDoc.close');
    expect(names).toEqual(['agentDoc.update', 'agentDoc.close']);
    expect(callsOf('agentDoc.update')[0]).toMatchObject({ text: 'typed', leaseId: 'G1', baseSha256: 'b'.repeat(64) });
    await tick(1000);
    expect(callsOf('agentDoc.update')).toHaveLength(1); // the debounce was cancelled
  });

  it('7: update carries the editor base sha, and a base-only change of a dirty document is sent', async () => {
    const state = leaseServer({ text: 'same', dirty: true, baseSha256: 'a'.repeat(64) });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    api.update('same', undefined, 'a'.repeat(64)); await tick(400);
    expect(callsOf('agentDoc.update')).toHaveLength(0);
    api.update('same', undefined, 'c'.repeat(64)); await tick(400);
    expect(callsOf('agentDoc.update')).toEqual([expect.objectContaining({ text: 'same', baseSha256: 'c'.repeat(64) })]);
    state.doc = { ...state.doc, dirty: false };
  });

  it('9: the echo of its own update does not re-open the document; a newer change announced meanwhile does', async () => {
    const state = leaseServer();
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    let release!: () => void;
    rpc.mockImplementation(async (_id, method, input) => {
      if (method === 'agentDoc.open') return ok(state.doc);
      if (method === 'agentDoc.update') {
        await new Promise<void>(r => { release = r; });
        state.doc = { ...state.doc, rev: state.doc.rev + 1, text: input.text }; return ok(state.doc);
      }
      return ok(state.doc);
    });
    const before = state.doc.rev;
    api.update('x'); await tick(400);
    rpc.mockClear();
    await event(before + 1); // the server's echo arrives before the RPC result
    expect(callsOf('agentDoc.open')).toHaveLength(0);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(1); });
    expect(callsOf('agentDoc.open')).toHaveLength(0);
    expect(api.doc?.rev).toBe(before + 1);
    // Another change lands while the next update is in flight: re-opened once the update settles.
    api.update('y'); await tick(400);
    await event(before + 5);
    expect(callsOf('agentDoc.open')).toHaveLength(0);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(1); });
    expect(callsOf('agentDoc.open')).toHaveLength(1);
  });

  it('resolve failures carrying the document refresh it', async () => {
    leaseServer();
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    rpc.mockImplementation(async (_id, method) => method === 'agentDoc.resolve' ? { ok: false, code: 'leased', error: 'applying', doc: snap({ rev: 99, lease: { ...mine, id: 'G1' } }) } : ok(snap()));
    let out: unknown; await act(async () => { out = await api.resolve('p1', 'reject'); });
    expect(out).toEqual({ ok: false, error: 'applying', code: 'leased' });
    expect(api.doc?.rev).toBe(99);
  });
});

describe('final review fixes', () => {
  it('3: a standby editor opens as a viewer: no lease, no renew, no close; its own old lease is not shown as held; ready acquires', async () => {
    const state = { doc: snap({ lease: { ...mine, id: 'OLD' } }) }; server(state);
    const view = render(<Probe projectId="p" path="a.agent" editor={{ ...ME, standby: true }} />); await tick();
    expect(methods()).toEqual(['agentDoc.open']);
    expect(api.heldBy).toBeNull(); expect(api.leased).toBe(false);
    api.update('ignored'); await tick(AGENT_DOC_LAPSE_CHECK_MS - 1_000);
    expect(methods().filter(m => m !== 'agentDoc.open')).toEqual([]);
    expect(await act(async () => api.takeOver())).toBe(false);
    // Ready: the same document is kept on screen while the editing session starts, then the lease is requested.
    view.rerender(<Probe projectId="p" path="a.agent" editor={ME} />);
    expect(api.doc).not.toBeNull();
    await tick();
    expect(callsOf('agentDoc.lease')).toEqual([{ projectId: 'p', path: 'a.agent', clientId: 'me', label: 'Studio' }]);
    expect(api.leased).toBe(true);
    // Another window's lease seen in standby is shown as held.
    state.doc = snap({ lease: other });
    view.rerender(<Probe projectId="p" path="b.agent" editor={{ ...ME, standby: true }} />); await tick();
    expect(api.heldBy).toEqual(other);
    expect(callsOf('agentDoc.close').at(-1)).toMatchObject({ projectId: 'p', path: 'a.agent', clientId: 'me' });
  });

  it('2: a viewer reads the document again once a lease it saw would have lapsed, re-armed by each snapshot', async () => {
    const state = { doc: snap({ lease: other }) }; server(state);
    const view = render(<Probe projectId="p" path="a.agent" />); await tick();
    const opens = () => callsOf('agentDoc.open').length;
    expect(opens()).toBe(1);
    await tick(AGENT_DOC_LAPSE_CHECK_MS - 10_000);
    state.doc = { ...state.doc, rev: 5 };
    await act(async () => { realtime!({ projectId: 'p', path: 'a.agent', rev: 5, kind: 'text' }); await vi.advanceTimersByTimeAsync(1); });
    expect(opens()).toBe(2);
    await tick(AGENT_DOC_LAPSE_CHECK_MS - 5_000); // re-armed by the newer snapshot
    expect(opens()).toBe(2);
    state.doc = { ...state.doc, rev: 6, lease: null };
    await tick(6_000);
    expect(opens()).toBe(3);
    expect(api.heldBy).toBeNull();
    await tick(AGENT_DOC_LAPSE_CHECK_MS * 2); // no lease: nothing to wait for
    expect(opens()).toBe(3);
    state.doc = { ...state.doc, rev: 7, lease: other };
    await act(async () => { realtime!({ projectId: 'p', path: 'a.agent', rev: 7, kind: 'lease' }); await vi.advanceTimersByTimeAsync(1); });
    view.unmount();
    await tick(AGENT_DOC_LAPSE_CHECK_MS * 2);
    expect(opens()).toBe(4); // cleared on cleanup
  });

  it('4: an update that keeps failing is re-queued with backoff, a bounded number of times, and a success resets it', async () => {
    let failing = true;
    const state = { doc: snap() };
    rpc.mockImplementation(async (_id, method, input) => {
      if (method === 'agentDoc.open') return ok(state.doc);
      if (method === 'agentDoc.lease') { state.doc = { ...state.doc, rev: state.doc.rev + 1, lease: mine }; return ok(state.doc); }
      if (method === 'agentDoc.update') {
        if (failing) return { ok: false, code: 'error', error: 'offline' };
        state.doc = { ...state.doc, rev: state.doc.rev + 1, text: input.text }; return ok(state.doc);
      }
      return ok(state.doc);
    });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    api.update('kept'); await tick(300);
    expect(callsOf('agentDoc.update')).toHaveLength(1);
    expect(api.error).toBe('offline');
    await tick(600); expect(callsOf('agentDoc.update')).toHaveLength(2);
    await tick(1200); expect(callsOf('agentDoc.update')).toHaveLength(3);
    await tick(2400); expect(callsOf('agentDoc.update')).toHaveLength(4);
    await tick(4800); expect(callsOf('agentDoc.update')).toHaveLength(5);
    await tick(60_000); expect(callsOf('agentDoc.update')).toHaveLength(5); // bounded: no storm
    failing = false;
    api.update('kept'); await tick(300 * 16);
    expect(callsOf('agentDoc.update').at(-1)).toMatchObject({ text: 'kept' });
    expect(api.doc?.text).toBe('kept'); expect(api.error).toBeNull();
  });

  it('4: a second stale is retried later, not dropped', async () => {
    let stale = 2;
    const state = { doc: snap() };
    rpc.mockImplementation(async (_id, method, input) => {
      if (method === 'agentDoc.open') return ok(state.doc);
      if (method === 'agentDoc.lease') { state.doc = { ...state.doc, rev: state.doc.rev + 1, lease: mine }; return ok(state.doc); }
      if (method === 'agentDoc.update') {
        if (stale-- > 0) return { ok: false, code: 'stale', error: 'moved' };
        state.doc = { ...state.doc, rev: state.doc.rev + 1, text: input.text }; return ok(state.doc);
      }
      return ok(state.doc);
    });
    render(<Probe projectId="p" path="a.agent" editor={ME} />); await tick();
    api.update('typed'); await tick(300);
    expect(callsOf('agentDoc.update')).toHaveLength(2);
    await tick(600);
    expect(api.doc?.text).toBe('typed');
  });
});

describe('newAgentDocClientId', () => {
  it('is unique and prefixed, with and without crypto.randomUUID', () => {
    const a = newAgentDocClientId(); const b = newAgentDocClientId();
    expect(a).toMatch(/^studio-/); expect(a).not.toBe(b);
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try { expect(newAgentDocClientId()).toMatch(/^studio-[a-z0-9]+-[a-z0-9]+$/); }
    finally { Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true }); }
  });
});

describe('stableAgentDocClientId', () => {
  beforeEach(() => sessionStorage.clear());
  it('returns the same id for a scope across calls (a reload) and a different one per scope', () => {
    const a = stableAgentDocClientId('p|tab');
    expect(stableAgentDocClientId('p|tab')).toBe(a);
    expect(stableAgentDocClientId('p|window')).not.toBe(a);
    expect(sessionStorage.getItem('salesforce:agentdoc-client:p|tab')).toBe(a);
  });
  it('ignores a malformed stored id and survives unavailable storage', () => {
    sessionStorage.setItem('salesforce:agentdoc-client:s', 'not valid!!');
    expect(stableAgentDocClientId('s')).toMatch(/^studio-/);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    try { expect(stableAgentDocClientId('t')).toMatch(/^studio-/); } finally { spy.mockRestore(); }
  });
});
