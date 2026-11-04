import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORE_APPROVAL_PRINCIPAL, createPluginApprovalVerifier } from '@zana-ai/zcc-server/http/plugin-approval-proof';
import type { ApprovalSheetOutcome } from '../window/approval-sheet.js';
import { startPeerUsePrompts, USE_APPROVE_ACTION, USE_STOP_ACTION, type PeerUsePromptDeps } from './peer-use-prompts.js';

const secret = 'desktop-only-boot-secret-of-at-least-32-bytes';
const now = 1_800_000_000_000;
const ID = '3f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const ID2 = '4f1c2b4a-5d6e-4f70-8a9b-0c1d2e3f4a5b';
const app = { id: 'plugin-x', name: 'Plugin X', enabled: true, status: 'running' };
const parent = { isDestroyed: () => false } as never;

function prompt(id = ID, pluginId = 'plugin-x', overrides: Record<string, unknown> = {}) {
  return { id, pluginId, request: { binding: { action: USE_APPROVE_ACTION, target: 'pair-1', targetLabel: 'Bee Mac', subject: `use:${pluginId}`, revision: id, ...overrides }, title: 'Allow a plugin to use a connection', summary: 'Allow Plugin X' } };
}

/** A controllable ndjson stream plus a record of the decision posts. */
function harness(overrides: Partial<PeerUsePromptDeps> = {}, outcome: ApprovalSheetOutcome = { kind: 'approved', typed: '' }) {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const posts: Array<{ url: string; body: { approved: boolean; token?: string } }> = [];
  const gets: string[] = [];
  const doFetch = vi.fn(async (input: URL | string, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(String(init.body)) }); return new Response('{}', { status: 200 }); }
    gets.push(url);
    const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    init?.signal?.addEventListener('abort', () => { try { controller.error(new Error('aborted')); } catch { /* closed */ } });
    return new Response(body, { status: 200 });
  });
  const showSheet = vi.fn(async () => outcome);
  const log = vi.fn();
  const deps: PeerUsePromptDeps = { secret: () => secret, serverUrl: () => 'http://127.0.0.1:9/', listApps: async () => [app], showSheet, pickParent: () => parent,
    fetch: doFetch as never, now: () => now, log, ...overrides };
  const handle = startPeerUsePrompts(deps);
  const send = (value: unknown, raw = false) => controller.enqueue(encoder.encode(raw ? String(value) : `${JSON.stringify(value)}\n`));
  return { handle, send, posts, gets, showSheet, log, doFetch, end: () => controller.close() };
}
const settle = () => vi.waitFor(() => undefined, { interval: 1 }).then(() => new Promise(resolve => setTimeout(resolve, 5)));

describe('startPeerUsePrompts', () => {
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('shows core text for an open prompt, signs exactly that binding with the core principal, and answers once', async () => {
    const h = harness();
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    expect(h.gets[0]).toBe('http://127.0.0.1:9/api/v1/peer-uses/prompts');
    h.send({ prompts: [prompt()] });
    await vi.waitFor(() => expect(h.posts).toHaveLength(1));
    expect(h.showSheet).toHaveBeenCalledWith(parent, { pluginName: 'Plugin X', request: prompt().request });
    expect(h.posts[0]!.url).toBe(`http://127.0.0.1:9/api/v1/peer-uses/${ID}/decision`);
    const verify = createPluginApprovalVerifier(secret, () => now);
    expect(h.posts[0]!.body.approved).toBe(true);
    expect(verify(h.posts[0]!.body.token, 'plugin-x', prompt().request.binding)).toBe(false);
    expect(verify(h.posts[0]!.body.token, CORE_APPROVAL_PRINCIPAL, prompt().request.binding)).toBe(true);
    // The same prompt in a later snapshot is not asked twice.
    h.send({ prompts: [prompt()] }); h.send({ ping: true }); h.send('not json\n', true);
    await settle();
    expect(h.showSheet).toHaveBeenCalledTimes(1);
    h.handle.stop();
  });

  it('answers denied when the owner cancels, and shows prompts one at a time', async () => {
    const h = harness({}, { kind: 'cancelled' });
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.send({ prompts: [prompt(ID), prompt(ID2)] });
    await vi.waitFor(() => expect(h.posts).toHaveLength(2));
    expect(h.posts.map(post => post.body)).toEqual([{ approved: false }, { approved: false }]);
    expect(h.showSheet).toHaveBeenCalledTimes(2);
    h.handle.stop();
  });

  it('accepts and core-signs an active-use Stop anyway prompt', async () => {
    const h = harness();
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.send({ prompts: [prompt(ID, 'plugin-x', { action: USE_STOP_ACTION })] });
    await vi.waitFor(() => expect(h.posts).toHaveLength(1));
    const verify = createPluginApprovalVerifier(secret, () => now);
    expect(verify(h.posts[0]!.body.token, CORE_APPROVAL_PRINCIPAL, prompt(ID, 'plugin-x', { action: USE_STOP_ACTION }).request.binding)).toBe(true);
    h.handle.stop();
  });

  it('never shows a sheet for a prompt that is malformed, names a disabled plugin, or is not the use action', async () => {
    const h = harness({ listApps: async () => [{ ...app, id: 'other-plugin' }, { ...app, id: 'plugin-off', enabled: false }] });
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.send({ prompts: [
      prompt(ID, 'plugin-x', { action: 'agent.publish' }),
      prompt(ID, 'plugin-x', { subject: 'use:someone-else' }),
      prompt(ID, 'plugin-x', { revision: ID2 }),
      prompt(ID, 'plugin-x', { confirmText: 'type me' }),
      prompt('not-a-uuid'),
      prompt(ID, 'Bad Id'),
      { id: ID, pluginId: 'plugin-x', request: {} },
      null,
      prompt(ID2, 'plugin-off')
    ] });
    await vi.waitFor(() => expect(h.posts).toHaveLength(1));
    // Only the disabled-plugin prompt is well formed; it is denied without a sheet.
    expect(h.posts[0]).toMatchObject({ body: { approved: false }, url: expect.stringContaining(ID2) });
    expect(h.showSheet).not.toHaveBeenCalled();
    h.send({ prompts: 'nope' });
    h.handle.stop();
  });

  it('waits for a window instead of failing, and skips a prompt withdrawn while it waited', async () => {
    let window: unknown = null;
    const h = harness({ pickParent: () => window as never });
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.send({ prompts: [prompt()] });
    await settle();
    expect(h.showSheet).not.toHaveBeenCalled();
    window = parent;
    await vi.waitFor(() => expect(h.posts).toHaveLength(1), { timeout: 5000 });
    expect(h.showSheet).toHaveBeenCalledTimes(1);
    h.handle.stop();

    window = null;
    const g = harness({ pickParent: () => window as never });
    await vi.waitFor(() => expect(g.gets).toHaveLength(1));
    g.send({ prompts: [prompt()] });
    await settle();
    g.send({ prompts: [] });
    window = parent;
    await new Promise(resolve => setTimeout(resolve, 2300));
    expect(g.showSheet).not.toHaveBeenCalled();
    expect(g.posts).toEqual([]);
    g.handle.stop();
  }, 15_000);

  it('does nothing without a real signing secret or when the parent is already gone', async () => {
    const h = harness({ secret: () => 'short' });
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.send({ prompts: [prompt()] });
    await settle();
    expect(h.showSheet).not.toHaveBeenCalled();
    expect(h.posts).toEqual([]);
    h.handle.stop();
    const g = harness({ pickParent: () => ({ isDestroyed: () => true }) as never });
    await vi.waitFor(() => expect(g.gets).toHaveLength(1));
    g.send({ prompts: [prompt()] });
    await settle();
    expect(g.showSheet).not.toHaveBeenCalled();
    g.handle.stop();
  });

  it('logs and carries on when a sheet throws or an answer is rejected', async () => {
    const h = harness({ showSheet: vi.fn(async () => { throw new Error('boom'); }) });
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.send({ prompts: [prompt()] });
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith('peer use prompt failed', expect.any(Error)));
    h.handle.stop();

    const encoder = new TextEncoder();
    const reject = vi.fn(async (_input: URL | string, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('no', { status: 403 });
      return new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(encoder.encode(`${JSON.stringify({ prompts: [prompt()] })}\n`)); } }), { status: 200 });
    });
    const rejected = harness({ fetch: reject as never });
    await vi.waitFor(() => expect(rejected.log).toHaveBeenCalledWith('peer use answer rejected (403)'), { timeout: 5000 });
    rejected.handle.stop();
  });

  it('reconnects with backoff after the stream drops and re-asks for what is still open', async () => {
    const h = harness();
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.end();
    await vi.waitFor(() => expect(h.gets).toHaveLength(2), { timeout: 5000 });
    h.send({ prompts: [prompt()] });
    await vi.waitFor(() => expect(h.posts).toHaveLength(1));
    h.handle.stop();
  }, 15_000);

  it('retries after a failed connect and stop releases the stream without further requests', async () => {
    const h = harness();
    h.doFetch.mockRejectedValueOnce(new Error('refused'));
    await settle();
    h.handle.stop();
    const calls = h.doFetch.mock.calls.length;
    await new Promise(resolve => setTimeout(resolve, 1300));
    expect(h.doFetch.mock.calls.length).toBe(calls);
  }, 10_000);

  it('refuses an oversize line from the stream', async () => {
    const h = harness();
    await vi.waitFor(() => expect(h.gets).toHaveLength(1));
    h.send('x'.repeat(300 * 1024), true);
    await vi.waitFor(() => expect(h.log).toHaveBeenCalledWith('peer use stream interrupted', expect.any(Error)));
    h.handle.stop();
  });
});
