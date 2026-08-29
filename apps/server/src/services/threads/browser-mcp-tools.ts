import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getBrowserAutomationHost } from './browser-automation.js';

const MAX_URL_LENGTH = 4096;
const MAX_SELECTOR_LENGTH = 1024;
const MAX_TYPED_TEXT_LENGTH = 8192;
const MAX_EVAL_SCRIPT_LENGTH = 16_384;

export const BROWSER_OPEN_DESCRIPTION = [
  'Open a visible in-app browser tab in this thread\'s side panel and return a target id.',
  'The user can watch the page. Use browser_snapshot after navigation, then click/type.',
  'http(s) URLs only. WebFetch remains the tool for headless page fetches.'
].join(' ');

function jsonResult(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function errorResult(message: string): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function requireHost() {
  const host = getBrowserAutomationHost();
  if (!host) {
    throw new Error('In-app browser is only available in the desktop app.');
  }
  return host;
}

async function run(fn: () => Promise<unknown>): Promise<{
  isError?: true;
  content: Array<{ type: 'text'; text: string }>;
}> {
  try {
    return jsonResult(await fn());
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : 'browser automation failed');
  }
}

export function registerBrowserAutomationTools(
  server: McpServer,
  opts: { threadId: string | null }
): void {
  const defaultThreadId = opts.threadId;

  server.registerTool(
    'browser_open',
    {
      description: BROWSER_OPEN_DESCRIPTION,
      inputSchema: {
        url: z.string().max(MAX_URL_LENGTH).describe('http(s) URL to load. Empty opens a blank tab.'),
        threadId: z.string().min(1).optional().describe('Thread to open the tab in. Defaults to this session\'s thread.'),
        visible: z.boolean().optional().describe('Open a visible side-panel tab. Defaults to true.')
      }
    },
    async ({ url, threadId, visible }) => run(async () => {
      const host = requireHost();
      const resolvedThreadId = threadId ?? defaultThreadId;
      if (!resolvedThreadId) {
        throw new Error('threadId is required when this tool is not session-scoped');
      }
      return host.open({
        threadId: resolvedThreadId,
        url,
        visible: visible !== false
      });
    })
  );

  server.registerTool(
    'browser_list',
    {
      description: 'List in-app browser automation targets the user can see.',
      inputSchema: {}
    },
    async () => run(async () => requireHost().list())
  );

  server.registerTool(
    'browser_snapshot',
    {
      description: 'Capture the current page URL, title, and a JPEG screenshot of an automation target.',
      inputSchema: {
        targetId: z.string().min(1).describe('Target id returned by browser_open.')
      }
    },
    async ({ targetId }) => run(async () => requireHost().snapshot(targetId))
  );

  server.registerTool(
    'browser_click',
    {
      description: 'Click an element in the in-app browser. Prefer selector over coordinates.',
      inputSchema: {
        targetId: z.string().min(1),
        selector: z.string().max(MAX_SELECTOR_LENGTH).optional(),
        x: z.number().optional(),
        y: z.number().optional()
      }
    },
    async ({ targetId, selector, x, y }) => run(async () => {
      await requireHost().click(targetId, { selector, x, y });
      return { ok: true };
    })
  );

  server.registerTool(
    'browser_type',
    {
      description: 'Type text into the in-app browser. Optionally focus a selector first.',
      inputSchema: {
        targetId: z.string().min(1),
        text: z.string().max(MAX_TYPED_TEXT_LENGTH),
        selector: z.string().max(MAX_SELECTOR_LENGTH).optional()
      }
    },
    async ({ targetId, text, selector }) => run(async () => {
      await requireHost().type(targetId, { text, selector });
      return { ok: true };
    })
  );

  server.registerTool(
    'browser_eval',
    {
      description: 'Evaluate a short JavaScript snippet in an automation-owned in-app browser tab. Keep it small and explain why.',
      inputSchema: {
        targetId: z.string().min(1),
        script: z.string().max(MAX_EVAL_SCRIPT_LENGTH)
      }
    },
    async ({ targetId, script }) => run(async () => ({ result: await requireHost().evaluate(targetId, script) }))
  );

  server.registerTool(
    'browser_close',
    {
      description: 'Close an in-app browser automation target.',
      inputSchema: {
        targetId: z.string().min(1)
      }
    },
    async ({ targetId }) => run(async () => {
      await requireHost().close(targetId);
      return { ok: true };
    })
  );
}
