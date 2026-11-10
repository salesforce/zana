import { describe, expect, it, vi } from 'vitest';
import {
  NATIVE_TOOL_POLICY_PROOF_HEADER,
  PTY_SESSION_TOOLS_PATH,
  PTY_SESSION_TOOL_CALL_PATH
} from '@zana-ai/zcc-server/http/native-tool-policy-proof';
import {
  createPtySessionTools,
  productRoutePtySessionToolCall,
  productRoutePtySessionTools,
  type PtySessionToolsDeps
} from './pty-session-tools.js';

const session = { id: 's1', projectId: 'p1', profile: 'codex', status: 'running', threadId: 't1' };
const tool = { name: 'do_thing', description: 'd', inputSchema: { type: 'object' } };
function make(over: Partial<PtySessionToolsDeps> = {}) {
  const log = vi.fn();
  const listSource = vi.fn().mockResolvedValue({ tools: [tool] });
  const callSource = vi.fn().mockResolvedValue({ success: true, contentItems: [{ type: 'inputText', text: 'ok' }] });
  const tools = createPtySessionTools({
    getSession: () => session,
    listSource: () => listSource,
    callSource: () => callSource,
    log,
    ...over
  });
  return { tools, log, listSource, callSource };
}

describe('createPtySessionTools', () => {
  it('lists with identity from the live record, not the caller', async () => {
    const { tools, listSource } = make();
    await expect(tools.list('p1', 's1')).resolves.toEqual([tool]);
    expect(listSource).toHaveBeenCalledWith({ sessionId: 's1', threadId: 't1', projectId: 'p1', profile: 'codex' });
  });

  it.each([
    ['unknown session', () => null],
    ['exited session', () => ({ ...session, status: 'exited' })],
    ['other project', () => ({ ...session, projectId: 'other' })],
    ['shell session', () => ({ ...session, profile: 'shell' })]
  ])('lists none and denies calls for an %s', async (_label, getSession) => {
    const { tools, listSource, callSource } = make({ getSession });
    await expect(tools.list('p1', 's1')).resolves.toEqual([]);
    const reply = await tools.call('p1', 's1', 'do_thing', {});
    expect(reply.success).toBe(false);
    expect(listSource).not.toHaveBeenCalled();
    expect(callSource).not.toHaveBeenCalled();
  });

  it('lists none without a channel, on error, on a bad reply and on timeout', async () => {
    expect(await make({ listSource: () => null }).tools.list('p1', 's1')).toEqual([]);
    const failing = make({ listSource: () => vi.fn().mockRejectedValue(new Error('x')) });
    expect(await failing.tools.list('p1', 's1')).toEqual([]);
    expect(failing.log).toHaveBeenCalled();
    const bad = make({ listSource: () => vi.fn().mockResolvedValue({ tools: 'nope' }) });
    expect(await bad.tools.list('p1', 's1')).toEqual([]);
    const slow = make({ listSource: () => () => new Promise(() => undefined), listTimeoutMs: 5 });
    expect(await slow.tools.list('p1', 's1')).toEqual([]);
  });

  it('calls with a fresh invocation id and the live identity', async () => {
    const { tools, callSource } = make();
    await expect(tools.call('p1', 's1', 'do_thing', { a: 1 })).resolves.toEqual({ success: true, contentItems: [{ type: 'inputText', text: 'ok' }] });
    await tools.call('p1', 's1', 'do_thing', { a: 1 });
    const [first, second] = callSource.mock.calls.map((c) => c[0]);
    expect(first).toMatchObject({ sessionId: 's1', threadId: 't1', projectId: 'p1', profile: 'codex', name: 'do_thing', arguments: { a: 1 } });
    expect(first.invocationId).not.toBe(second.invocationId);
  });

  it('fails closed on no channel, error, bad reply and timeout, never logging arguments', async () => {
    const none = await make({ callSource: () => null }).tools.call('p1', 's1', 'do_thing', {});
    expect(none.success).toBe(false);
    const failing = make({ callSource: () => vi.fn().mockRejectedValue(new Error('boom')) });
    expect((await failing.tools.call('p1', 's1', 'do_thing', { secret: 'hunter2' })).success).toBe(false);
    expect(JSON.stringify(failing.log.mock.calls)).not.toContain('hunter2');
    const bad = make({ callSource: () => vi.fn().mockResolvedValue({ success: 'yes' }) });
    expect((await bad.tools.call('p1', 's1', 'do_thing', {})).success).toBe(false);
    const slow = make({ callSource: () => () => new Promise(() => undefined), callTimeoutMs: 5 });
    expect((await slow.tools.call('p1', 's1', 'do_thing', {})).success).toBe(false);
  });
});

describe('product route twins', () => {
  const deps = (fetchImpl: typeof fetch) => ({
    serverUrl: () => 'http://127.0.0.1:1234',
    credential: () => 'c'.repeat(64),
    fetch: fetchImpl
  });
  it('post the signed request to the list and call paths', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ tools: [] }), { status: 200 }));
    await productRoutePtySessionTools(deps(fetchImpl as unknown as typeof fetch))({ sessionId: 's1', projectId: 'p1', profile: 'codex' });
    await productRoutePtySessionToolCall(deps(fetchImpl as unknown as typeof fetch))({
      sessionId: 's1', projectId: 'p1', profile: 'codex', invocationId: '3f2b8c1e-6d4a-4b0f-9a7e-1c2d3e4f5a6b', name: 'n', arguments: {}
    });
    const [listCall, callCall] = fetchImpl.mock.calls;
    expect(String(listCall[0])).toBe(`http://127.0.0.1:1234${PTY_SESSION_TOOLS_PATH}`);
    expect(String(callCall[0])).toBe(`http://127.0.0.1:1234${PTY_SESSION_TOOL_CALL_PATH}`);
    expect(listCall[1].headers[NATIVE_TOOL_POLICY_PROOF_HEADER]).toMatch(/^\d{13}\./);
  });

  it('throw on a non-ok answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('no', { status: 403 }));
    await expect(productRoutePtySessionTools(deps(fetchImpl as unknown as typeof fetch))({})).rejects.toThrow('HTTP 403');
  });
});
