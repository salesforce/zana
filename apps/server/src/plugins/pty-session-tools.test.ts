import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PtySessionToolCallMainRequestSchema,
  PtySessionToolCallReplySchema,
  PtySessionToolsMainRequestSchema,
  PtySessionToolsReplySchema,
  PTY_SESSION_TOOL_RESULT_MAX_CHARS
} from '@zana-ai/zcc-contracts/runtime';
import { callMainOwnedPtyTool, listMainOwnedPtyTools } from './pty-session-tools.js';
import { decideMainOwnedToolPolicy, resetNativeAllowsForTest } from './native-tool-policy.js';

const listReq = { sessionId: 's1', projectId: 'p1', profile: 'codex-yolo' } as const;
const callReq = {
  ...listReq,
  invocationId: '3f2b8c1e-6d4a-4b0f-9a7e-1c2d3e4f5a6b',
  name: 'do_thing',
  arguments: { token: 'secret-value', n: 1 }
} as const;
const tool = (name: string, extra: object = {}) => ({ name, description: `${name} desc`, inputSchema: { type: 'object', properties: {} }, ...extra });
afterEach(() => vi.restoreAllMocks());

describe('listMainOwnedPtyTools', () => {
  it('answers none without a plugin service', async () => {
    await expect(listMainOwnedPtyTools(undefined, listReq)).resolves.toEqual({ tools: [] });
  });

  it('asks with the pty identity and lists the bounded tools', async () => {
    const ptySessionTools = vi.fn().mockResolvedValue({
      tools: [tool('ok_tool'), tool('bad name!'), tool('x'.repeat(200)), { ...tool('long'), description: 'd'.repeat(9000) }, { ...tool('noschema'), inputSchema: 'nope' }]
    });
    const reply = await listMainOwnedPtyTools({ ptySessionTools }, { ...listReq, threadId: 't9' });
    expect(ptySessionTools).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'pty', sessionId: 's1', threadId: 't9', projectId: 'p1', project: { id: 'p1' }, provider: { id: 'codex' }
    }));
    expect(reply.tools.map((t) => t.name)).toEqual(['ok_tool', 'long', 'noschema']);
    expect(reply.tools[1]!.description).toHaveLength(4096);
    expect(reply.tools[2]!.inputSchema).toEqual({ type: 'object' });
    expect(PtySessionToolsReplySchema.safeParse(reply).success).toBe(true);
  });

  it('defaults threadId to the session id and caps the count', async () => {
    const ptySessionTools = vi.fn().mockResolvedValue({ tools: Array.from({ length: 300 }, (_, i) => tool(`t${i}`)) });
    const reply = await listMainOwnedPtyTools({ ptySessionTools }, listReq);
    expect(ptySessionTools.mock.calls[0]![0]).toMatchObject({ threadId: 's1' });
    expect(reply.tools).toHaveLength(128);
  });

  it('lists none when the plugin service throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ptySessionTools = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(listMainOwnedPtyTools({ ptySessionTools }, listReq)).resolves.toEqual({ tools: [] });
  });
});

describe('callMainOwnedPtyTool', () => {
  beforeEach(() => resetNativeAllowsForTest());
  const plugins = (over: Record<string, unknown> = {}) => ({
    ptySessionTools: vi.fn().mockResolvedValue({ tools: [tool('do_thing')] }),
    decideToolPolicy: vi.fn().mockResolvedValue({ action: 'allow' }),
    invokePtySessionTool: vi.fn().mockResolvedValue({ success: true, contentItems: [{ type: 'inputText', text: 'done' }] }),
    ...over
  });
  const asService = (p: ReturnType<typeof plugins>) => p as unknown as Parameters<typeof callMainOwnedPtyTool>[0];

  it('skips the second policy evaluation once, only when the native hook already allowed the same call', async () => {
    resetNativeAllowsForTest();
    const p = plugins();
    const native = { invocationId: 'n'.repeat(64), sessionId: callReq.sessionId, projectId: callReq.projectId, profile: callReq.profile };
    await decideMainOwnedToolPolicy(p, { ...native, toolName: `mcp__zcc-inbox__${callReq.name}`, input: callReq.arguments });
    expect(p.decideToolPolicy).toHaveBeenCalledTimes(1);
    expect((await callMainOwnedPtyTool(asService(p), callReq)).success).toBe(true);
    expect(p.decideToolPolicy).toHaveBeenCalledTimes(1);
    // one-shot: a repeat call is evaluated again
    await callMainOwnedPtyTool(asService(p), callReq);
    expect(p.decideToolPolicy).toHaveBeenCalledTimes(2);
    // different input or a denied native call never leaves an allow behind
    await decideMainOwnedToolPolicy(p, { ...native, toolName: callReq.name, input: { other: 1 } });
    await callMainOwnedPtyTool(asService(p), callReq);
    expect(p.decideToolPolicy).toHaveBeenCalledTimes(4);
    const denying = plugins({ decideToolPolicy: vi.fn().mockResolvedValue({ action: 'deny', reason: 'no' }) });
    await decideMainOwnedToolPolicy(denying, { ...native, toolName: callReq.name, input: callReq.arguments });
    expect((await callMainOwnedPtyTool(asService(denying), callReq)).success).toBe(false);
    expect(denying.decideToolPolicy).toHaveBeenCalledTimes(2);
  });

  it('denies without a plugin service', async () => {
    const reply = await callMainOwnedPtyTool(undefined, callReq);
    expect(reply.success).toBe(false);
    expect(reply.contentItems[0]).toMatchObject({ text: expect.stringContaining('denied') });
  });

  it('applies pty policy with redacted input, then invokes the plugin', async () => {
    const p = plugins();
    const reply = await callMainOwnedPtyTool(asService(p), callReq);
    expect(reply).toEqual({ success: true, contentItems: [{ type: 'inputText', text: 'done' }] });
    expect(p.decideToolPolicy).toHaveBeenCalledWith(expect.objectContaining({
      surface: 'pty', sessionId: 's1', threadId: 's1', projectId: 'p1', providerId: 'codex', toolName: 'do_thing',
      input: { token: '[REDACTED]', n: 1 }
    }));
    expect(p.invokePtySessionTool).toHaveBeenCalledWith(expect.objectContaining({
      name: 'do_thing', input: callReq.arguments, ctx: expect.objectContaining({ threadId: 's1', projectId: 'p1' })
    }));
    // Policy decided before the plugin ran.
    expect(p.decideToolPolicy.mock.invocationCallOrder[0]).toBeLessThan(p.invokePtySessionTool.mock.invocationCallOrder[0]!);
  });

  it('does not run the plugin when policy denies', async () => {
    const p = plugins({ decideToolPolicy: vi.fn().mockResolvedValue({ action: 'deny', reason: 'not here' }) });
    const reply = await callMainOwnedPtyTool(asService(p), callReq);
    expect(reply).toEqual({ success: false, contentItems: [{ type: 'inputText', text: 'Tool "do_thing" denied: not here' }] });
    expect(p.invokePtySessionTool).not.toHaveBeenCalled();
  });

  it('fails closed when policy throws or answers an invalid decision', async () => {
    const thrown = plugins({ decideToolPolicy: vi.fn().mockRejectedValue(new Error('down')) });
    expect((await callMainOwnedPtyTool(asService(thrown), callReq)).success).toBe(false);
    expect(thrown.invokePtySessionTool).not.toHaveBeenCalled();
    const odd = plugins({ decideToolPolicy: vi.fn().mockResolvedValue({ action: 'maybe' }) });
    expect((await callMainOwnedPtyTool(asService(odd), callReq)).success).toBe(false);
    expect(odd.invokePtySessionTool).not.toHaveBeenCalled();
  });

  it('refuses a tool outside the session list, before policy', async () => {
    const p = plugins({ ptySessionTools: vi.fn().mockResolvedValue({ tools: [tool('other')] }) });
    const reply = await callMainOwnedPtyTool(asService(p), callReq);
    expect(reply).toEqual({ success: false, contentItems: [{ type: 'inputText', text: 'Unsupported tool: do_thing' }] });
    expect(p.decideToolPolicy).not.toHaveBeenCalled();
    expect(p.invokePtySessionTool).not.toHaveBeenCalled();
  });

  it('fails closed when the session tool list cannot be resolved', async () => {
    const p = plugins({ ptySessionTools: vi.fn().mockRejectedValue(new Error('x')) });
    expect((await callMainOwnedPtyTool(asService(p), callReq)).success).toBe(false);
    expect(p.invokePtySessionTool).not.toHaveBeenCalled();
  });

  it('turns a plugin error into a failure result', async () => {
    const p = plugins({ invokePtySessionTool: vi.fn().mockRejectedValue(new Error('kaput')) });
    expect(await callMainOwnedPtyTool(asService(p), callReq)).toEqual({
      success: false, contentItems: [{ type: 'inputText', text: 'Tool "do_thing" failed: kaput' }]
    });
  });

  it('caps oversize text and images, and keeps a plugin-reported failure', async () => {
    const images = Array.from({ length: 12 }, () => ({ type: 'inputImage' as const, imageUrl: 'data:image/png;base64,AA==' }));
    const p = plugins({
      invokePtySessionTool: vi.fn().mockResolvedValue({
        success: false,
        contentItems: [{ type: 'inputText', text: 'y'.repeat(PTY_SESSION_TOOL_RESULT_MAX_CHARS + 50) }, ...images]
      })
    });
    const reply = await callMainOwnedPtyTool(asService(p), callReq);
    expect(reply.success).toBe(false);
    expect(reply.contentItems).toHaveLength(9);
    expect((reply.contentItems[0] as { text: string }).text.endsWith('[truncated]')).toBe(true);
    expect(PtySessionToolCallReplySchema.safeParse(reply).success).toBe(true);
  });
});

describe('pty session tools contract', () => {
  it('is strict and bounded', () => {
    expect(PtySessionToolsMainRequestSchema.safeParse(listReq).success).toBe(true);
    expect(PtySessionToolsMainRequestSchema.safeParse({ ...listReq, extra: 1 }).success).toBe(false);
    expect(PtySessionToolCallMainRequestSchema.safeParse(callReq).success).toBe(true);
    expect(PtySessionToolCallMainRequestSchema.safeParse({ ...callReq, extra: 1 }).success).toBe(false);
    expect(PtySessionToolCallMainRequestSchema.safeParse({ ...callReq, name: 'a b' }).success).toBe(false);
    expect(PtySessionToolCallMainRequestSchema.safeParse({ ...callReq, invocationId: 'nope' }).success).toBe(false);
    expect(PtySessionToolCallMainRequestSchema.safeParse({ ...callReq, arguments: { a: 'x'.repeat(300_000) } }).success).toBe(false);
  });
});
