import { describe, expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ append: vi.fn() }));
vi.mock('@zana-ai/zcc-db', () => ({ appendConversationThreadEvent: h.append }));

import { emitPersonaMcpNotice, emitPersonaNotice } from './persona-notice.js';
import { PERSONA_MCP_ALLOWLIST_OPERATION } from './persona-mcp-allowlist.js';

beforeEach(() => h.append.mockReset());

describe('persona-notice', () => {
  it('records nothing for an empty message', () => {
    const emit = vi.fn();
    emitPersonaNotice({ db: {}, hub: { emit } } as never, 't1', 'op', undefined);
    expect(h.append).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('appends a warning system/operation event and emits it on the hub', () => {
    h.append.mockReturnValue({ threadId: 't1', sequence: 4, type: 'system/operation', payload: { p: 1 } });
    const emit = vi.fn();
    emitPersonaNotice({ db: {}, hub: { emit } } as never, 't1', 'my_op', 'hello');
    expect(h.append.mock.calls[0]![1]).toMatchObject({
      threadId: 't1', type: 'system/operation',
      payload: { operation: 'my_op', status: 'warning', message: 'hello', operationId: 'my-op:t1' }
    });
    expect(emit).toHaveBeenCalledWith('threads:event', expect.objectContaining({ threadId: 't1', sequence: 4, kind: 'thread.event' }));
  });

  it('emitPersonaMcpNotice uses the allowlist operation', () => {
    h.append.mockReturnValue({ threadId: 't2', sequence: 1, type: 'system/operation', payload: {} });
    emitPersonaMcpNotice({ db: {}, hub: { emit: vi.fn() } } as never, 't2', 'm');
    expect(h.append.mock.calls[0]![1].payload.operation).toBe(PERSONA_MCP_ALLOWLIST_OPERATION);
  });

  it.each([[new Error('boom'), 'boom'], ['plain string', 'plain string']])('swallows a failure (%s) and logs a trace', (thrown, text) => {
    h.append.mockImplementation(() => { throw thrown; });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => emitPersonaNotice({ db: {}, hub: { emit: vi.fn() } } as never, 't3', 'op', 'x')).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(text));
    warn.mockRestore();
  });
});
