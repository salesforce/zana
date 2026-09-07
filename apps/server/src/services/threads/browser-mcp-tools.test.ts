import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerBrowserAutomationTools } from './browser-mcp-tools.js';
import {
  setBrowserAutomationHost,
  type BrowserAutomationHost
} from './browser-automation.js';

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

function payload(res: { content: Array<{ type: string; text?: string }> }) {
  return JSON.parse(res.content.find((c) => c.type === 'text')?.text ?? '{}');
}

const stubHost: BrowserAutomationHost = {
  open: async () => ({ targetId: 'tgt_1', tabId: 'browser:1' }),
  list: async () => [{ targetId: 'tgt_1', tabId: 'browser:1', url: 'https://a.test', title: 'A' }],
  snapshot: async () => ({
    targetId: 'tgt_1',
    tabId: 'browser:1',
    url: 'https://a.test',
    title: 'A',
    dataUrl: null
  }),
  click: async () => undefined,
  type: async () => undefined,
  evaluate: async () => 'ok',
  close: async () => undefined
};

describe('registerBrowserAutomationTools', () => {
  afterEach(() => {
    setBrowserAutomationHost(null);
  });

  it('fails closed when no desktop host is registered', async () => {
    setBrowserAutomationHost(null);
    const { server, tools } = fakeServer();
    registerBrowserAutomationTools(server as never, { threadId: 'thr_1' });
    const res = await tools.get('browser_open')!({ url: 'https://a.test' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('desktop app');
  });

  it('opens and lists through a stub host using the session thread id', async () => {
    setBrowserAutomationHost(stubHost);
    const { server, tools } = fakeServer();
    registerBrowserAutomationTools(server as never, { threadId: 'thr_1' });
    expect([...tools.keys()]).toEqual([
      'browser_open',
      'browser_list',
      'browser_snapshot',
      'browser_click',
      'browser_type',
      'browser_eval',
      'browser_close'
    ]);
    const opened = payload(await tools.get('browser_open')!({ url: 'https://a.test' }));
    expect(opened).toEqual({ targetId: 'tgt_1', tabId: 'browser:1' });
    const listed = payload(await tools.get('browser_list')!({}));
    expect(listed).toHaveLength(1);
    expect(listed[0].targetId).toBe('tgt_1');
  });

  it('requires a session-scoped route and ignores an agent-supplied threadId', async () => {
    const open = vi.fn(async (args: { threadId: string }) => ({ targetId: 'tgt_1', tabId: 'browser:1', ...args }));
    setBrowserAutomationHost({ ...stubHost, open });
    const unscoped = fakeServer();
    registerBrowserAutomationTools(unscoped.server as never, { threadId: null });
    const missing = await unscoped.tools.get('browser_open')!({ url: 'https://a.test' });
    expect(missing.isError).toBe(true);
    expect(missing.content[0]?.text).toContain('session-scoped');

    const scoped = fakeServer();
    registerBrowserAutomationTools(scoped.server as never, { threadId: 'thr_1' });
    await scoped.tools.get('browser_open')!({ url: 'https://a.test', threadId: 'forged' });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ threadId: 'thr_1' }));
    const listed = payload(await scoped.tools.get('browser_list')!({}));
    expect(listed).toHaveLength(1);
  });

  it('forwards click, type, eval, and close to the host', async () => {
    const host = {
      ...stubHost,
      snapshot: vi.fn(stubHost.snapshot),
      click: vi.fn(async () => undefined),
      type: vi.fn(async () => undefined),
      evaluate: vi.fn(async () => '2'),
      close: vi.fn(async () => undefined)
    };
    setBrowserAutomationHost(host);
    const { server, tools } = fakeServer();
    registerBrowserAutomationTools(server as never, { threadId: 'thr_1' });
    expect(payload(await tools.get('browser_click')!({ targetId: 'tgt_1', selector: 'a' }))).toEqual({ ok: true });
    expect(host.click).toHaveBeenCalledWith('tgt_1', { selector: 'a', x: undefined, y: undefined }, 'thr_1');
    expect(payload(await tools.get('browser_type')!({ targetId: 'tgt_1', text: 'hi' }))).toEqual({ ok: true });
    expect(host.type).toHaveBeenCalledWith('tgt_1', { text: 'hi', selector: undefined }, 'thr_1');
    expect(payload(await tools.get('browser_eval')!({ targetId: 'tgt_1', script: '1+1' }))).toEqual({ result: '2' });
    expect(host.evaluate).toHaveBeenCalledWith('tgt_1', '1+1', 'thr_1');
    expect(payload(await tools.get('browser_close')!({ targetId: 'tgt_1' }))).toEqual({ ok: true });
    expect(host.close).toHaveBeenCalledWith('tgt_1', 'thr_1');
    expect(payload(await tools.get('browser_snapshot')!({ targetId: 'tgt_1' })).targetId).toBe('tgt_1');
    expect(host.snapshot).toHaveBeenCalledWith('tgt_1', 'thr_1');
  });
});
