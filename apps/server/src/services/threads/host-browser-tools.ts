/**
 * Host `browser_*` DynamicTools for conversation threads.
 *
 * PTY Claude gets these via zcc-inbox MCP. Conversation sessions only receive
 * packed DynamicTools, so "open this URL" fell through to Cursor/Chrome.
 * Identity is closed over from the owning conversation row (Rule 1) — the
 * agent cannot name another thread.
 */

import type { DynamicTool, ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import { pluginToolResultToResponse } from '../../plugins/plugin-agent-tools.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { getBrowserAutomationHost } from './browser-automation.js';

export const BROWSER_OPEN_NAME = 'browser_open';
export const BROWSER_LIST_NAME = 'browser_list';
export const BROWSER_SNAPSHOT_NAME = 'browser_snapshot';
export const BROWSER_CLICK_NAME = 'browser_click';
export const BROWSER_TYPE_NAME = 'browser_type';
export const BROWSER_EVAL_NAME = 'browser_eval';
export const BROWSER_CLOSE_NAME = 'browser_close';

export const HOST_BROWSER_TOOL_NAMES = [
  BROWSER_OPEN_NAME,
  BROWSER_LIST_NAME,
  BROWSER_SNAPSHOT_NAME,
  BROWSER_CLICK_NAME,
  BROWSER_TYPE_NAME,
  BROWSER_EVAL_NAME,
  BROWSER_CLOSE_NAME
] as const;

const MAX_URL_LENGTH = 4096;
const MAX_SELECTOR_LENGTH = 1024;
const MAX_TYPED_TEXT_LENGTH = 8192;
const MAX_EVAL_SCRIPT_LENGTH = 16_384;

export const BROWSER_OPEN_DESCRIPTION = [
  "Open a visible in-app browser tab in this thread's side panel and return a target id.",
  'Use this whenever the user asks you to open, show, or browse a web page.',
  'Do not open Chrome, Cursor, VS Code, or an external browser — those leave this app.',
  'http(s) URLs only. WebFetch remains the tool for headless page fetches.',
  'Use browser_snapshot after navigation, then click/type.'
].join(' ');

export const HOST_BROWSER_INSTRUCTION = [
  'When the user asks you to open, show, or browse a web page, call `browser_open`.',
  "That opens this thread's right-hand in-app browser tab.",
  'Do not open Chrome, Cursor, or an external browser.'
].join(' ');

export const HOST_BROWSER_TOOLS: DynamicTool[] = [
  {
    name: BROWSER_OPEN_NAME,
    description: BROWSER_OPEN_DESCRIPTION,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        url: {
          type: 'string',
          maxLength: MAX_URL_LENGTH,
          description: 'http(s) URL to load. Empty opens a blank tab.'
        },
        visible: {
          type: 'boolean',
          description: 'Open a visible side-panel tab. Defaults to true.'
        }
      }
    },
    presentation: {
      label: { pending: 'Opening browser', completed: 'Opened browser' },
      icon: { glyph: 'Globe' }
    }
  },
  {
    name: BROWSER_LIST_NAME,
    description: 'List in-app browser automation targets the user can see in this thread.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
    presentation: {
      label: { pending: 'Listing browser tabs', completed: 'Listed browser tabs' },
      icon: { glyph: 'Globe' }
    }
  },
  {
    name: BROWSER_SNAPSHOT_NAME,
    description: 'Capture the current page URL, title, and a JPEG screenshot of an automation target.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['targetId'],
      properties: {
        targetId: { type: 'string', minLength: 1, description: 'Target id returned by browser_open.' }
      }
    },
    presentation: {
      label: { pending: 'Capturing page', completed: 'Captured page' },
      icon: { glyph: 'Camera' }
    }
  },
  {
    name: BROWSER_CLICK_NAME,
    description: 'Click an element in the in-app browser. Prefer selector over coordinates.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['targetId'],
      properties: {
        targetId: { type: 'string', minLength: 1 },
        selector: { type: 'string', maxLength: MAX_SELECTOR_LENGTH },
        x: { type: 'number' },
        y: { type: 'number' }
      }
    },
    presentation: {
      label: { pending: 'Clicking', completed: 'Clicked' },
      icon: { glyph: 'MousePointer' }
    }
  },
  {
    name: BROWSER_TYPE_NAME,
    description: 'Type text into the in-app browser. Optionally focus a selector first.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['targetId', 'text'],
      properties: {
        targetId: { type: 'string', minLength: 1 },
        text: { type: 'string', maxLength: MAX_TYPED_TEXT_LENGTH },
        selector: { type: 'string', maxLength: MAX_SELECTOR_LENGTH }
      }
    },
    presentation: {
      label: { pending: 'Typing', completed: 'Typed' },
      icon: { glyph: 'Keyboard' }
    }
  },
  {
    name: BROWSER_EVAL_NAME,
    description: 'Evaluate a short JavaScript snippet in an automation-owned in-app browser tab. Keep it small and explain why.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['targetId', 'script'],
      properties: {
        targetId: { type: 'string', minLength: 1 },
        script: { type: 'string', maxLength: MAX_EVAL_SCRIPT_LENGTH }
      }
    },
    presentation: {
      label: { pending: 'Running script', completed: 'Ran script' },
      icon: { glyph: 'Code' }
    }
  },
  {
    name: BROWSER_CLOSE_NAME,
    description: 'Close an in-app browser automation target.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['targetId'],
      properties: {
        targetId: { type: 'string', minLength: 1 }
      }
    },
    presentation: {
      label: { pending: 'Closing tab', completed: 'Closed tab' },
      icon: { glyph: 'X' }
    }
  }
];

function fail(name: string, error: string): ToolCallResponse {
  return pluginToolResultToResponse(name, { ok: false, error });
}

function row(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return input as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export async function invokeHostBrowserTool(
  ctx: ProductHttpContext,
  args: { name: string; threadId: string; projectId: string; input: unknown }
): Promise<ToolCallResponse> {
  const { name, threadId, input } = args;
  const fields = row(input);
  try {
    if (name === BROWSER_OPEN_NAME) {
      const url = typeof fields.url === 'string' ? fields.url.slice(0, MAX_URL_LENGTH) : '';
      const visible = fields.visible !== false;
      const host = getBrowserAutomationHost();
      if (host) {
        return pluginToolResultToResponse(name, await host.open({ threadId, url, visible }));
      }
      ctx.hub.emit('threads:browser', { threadId, url, visible });
      const delivered = ctx.hub.size();
      if (delivered === 0) {
        return fail(name, 'No connected app window received the browser tab. Is the desktop app open?');
      }
      return pluginToolResultToResponse(name, {
        ok: true,
        delivered,
        note: 'Opened a visible in-app browser tab. Snapshot/click/type need an automation target from the desktop app.'
      });
    }

    const host = getBrowserAutomationHost();
    if (!host) {
      return fail(name, 'In-app browser automation is only available in the desktop app.');
    }

    if (name === BROWSER_LIST_NAME) {
      return pluginToolResultToResponse(name, await host.list(threadId));
    }
    if (name === BROWSER_SNAPSHOT_NAME) {
      return pluginToolResultToResponse(name, await host.snapshot(requireString(fields.targetId, 'targetId')));
    }
    if (name === BROWSER_CLICK_NAME) {
      await host.click(requireString(fields.targetId, 'targetId'), {
        selector: typeof fields.selector === 'string' ? fields.selector.slice(0, MAX_SELECTOR_LENGTH) : undefined,
        x: typeof fields.x === 'number' ? fields.x : undefined,
        y: typeof fields.y === 'number' ? fields.y : undefined
      });
      return pluginToolResultToResponse(name, { ok: true });
    }
    if (name === BROWSER_TYPE_NAME) {
      const text = typeof fields.text === 'string' ? fields.text : '';
      if (text.length > MAX_TYPED_TEXT_LENGTH) throw new Error('text is too long');
      await host.type(requireString(fields.targetId, 'targetId'), {
        text,
        selector: typeof fields.selector === 'string' ? fields.selector.slice(0, MAX_SELECTOR_LENGTH) : undefined
      });
      return pluginToolResultToResponse(name, { ok: true });
    }
    if (name === BROWSER_EVAL_NAME) {
      const script = typeof fields.script === 'string' ? fields.script : '';
      if (script.length > MAX_EVAL_SCRIPT_LENGTH) throw new Error('script is too long');
      return pluginToolResultToResponse(name, {
        result: await host.evaluate(requireString(fields.targetId, 'targetId'), script)
      });
    }
    if (name === BROWSER_CLOSE_NAME) {
      await host.close(requireString(fields.targetId, 'targetId'));
      return pluginToolResultToResponse(name, { ok: true });
    }
    return fail(name, `Unsupported browser tool: ${name}`);
  } catch (error) {
    return fail(name, error instanceof Error ? error.message : 'browser automation failed');
  }
}
