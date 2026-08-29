import { describe, it, expect, vi } from 'vitest';
import {
  registerCloseSessionTools,
  type RegisterCloseSessionOpts
} from './close-session-mcp-tool.js';
import { createMemoryInboxStore, type IInboxStore } from '@zana-ai/zcc-server';

/**
 * Minimal fake McpServer that captures the tools registered on it, so we can
 * invoke each handler directly without booting an HTTP transport. Mirrors the
 * shape `registerTool(name, def, handler)` the SDK exposes.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }
  };
  return { server, tools };
}

function text(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.find((c) => c.type === 'text')?.text ?? '';
}

function makeOpts(over: Partial<RegisterCloseSessionOpts> = {}): RegisterCloseSessionOpts {
  return {
    sessionId: 'sess-1',
    projectId: 'p1',
    projectLabel: 'Proj One',
    closeTerminal: vi.fn(() => true),
    inboxStore: createMemoryInboxStore(),
    // Run the deferred close synchronously so assertions don't wait on a timer.
    defer: (fn) => fn(),
    ...over
  };
}

describe('registerCloseSessionTools', () => {
  it('registers both tools', () => {
    const { server, tools } = fakeServer();
    registerCloseSessionTools(server as never, makeOpts());
    expect([...tools.keys()].sort()).toEqual(['close_session', 'close_session_with_summary']);
  });

  it('close_session closes its own (URL-derived) session', async () => {
    const closeTerminal = vi.fn(() => true);
    const { server, tools } = fakeServer();
    registerCloseSessionTools(server as never, makeOpts({ closeTerminal }));
    const res = await tools.get('close_session')!({});
    expect(res.isError).toBeFalsy();
    expect(closeTerminal).toHaveBeenCalledWith('sess-1');
  });

  it('close_session_with_summary writes the inbox entry THEN closes', async () => {
    const order: string[] = [];
    const inbox = createMemoryInboxStore();
    const appendSpy = vi.spyOn(inbox, 'append');
    const closeTerminal = vi.fn(() => {
      order.push('close');
      return true;
    });
    const { server, tools } = fakeServer();
    registerCloseSessionTools(
      server as never,
      makeOpts({
        inboxStore: inbox,
        closeTerminal,
        defer: (fn) => {
          order.push('defer');
          fn();
        }
      })
    );
    const res = await tools.get('close_session_with_summary')!({ summary: 'Did the thing.' });
    expect(res.isError).toBeFalsy();
    expect(appendSpy).toHaveBeenCalledTimes(1);
    const arg = appendSpy.mock.calls[0][0];
    expect(arg).toMatchObject({ projectId: 'p1', projectLabel: 'Proj One', sessionId: 'sess-1' });
    expect(arg.comments).toContain('Did the thing.');
    // The inbox write resolved before the close was even scheduled.
    expect(order).toEqual(['defer', 'close']);
  });

  it('close_session_with_summary does NOT close when the inbox write fails', async () => {
    const inbox: IInboxStore = createMemoryInboxStore();
    vi.spyOn(inbox, 'append').mockRejectedValueOnce(new Error('disk full'));
    const closeTerminal = vi.fn(() => true);
    const { server, tools } = fakeServer();
    registerCloseSessionTools(server as never, makeOpts({ inboxStore: inbox, closeTerminal }));
    const res = await tools.get('close_session_with_summary')!({ summary: 'x' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('session left open');
    expect(closeTerminal).not.toHaveBeenCalled();
  });

  it('both tools error (and do not close) when there is no originating session', async () => {
    const closeTerminal = vi.fn(() => true);
    const { server, tools } = fakeServer();
    registerCloseSessionTools(server as never, makeOpts({ sessionId: undefined, closeTerminal }));
    const a = await tools.get('close_session')!({});
    const b = await tools.get('close_session_with_summary')!({ summary: 'x' });
    expect(a.isError).toBe(true);
    expect(b.isError).toBe(true);
    expect(closeTerminal).not.toHaveBeenCalled();
  });
});
