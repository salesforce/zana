import { afterEach, describe, expect, it } from 'vitest';
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

  it('requires a thread id when the tool is not session-scoped', async () => {
    setBrowserAutomationHost(stubHost);
    const { server, tools } = fakeServer();
    registerBrowserAutomationTools(server as never, { threadId: null });
    const res = await tools.get('browser_open')!({ url: 'https://a.test' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('threadId is required');
  });
});
