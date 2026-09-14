import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  desktopBrowserAcquireRequestSchema,
  desktopBrowserCreateRequestSchema,
  desktopBrowserHostRequestSchema,
  desktopBrowserImportCookiesRequestSchema,
  desktopBrowserInstanceRequestSchema,
  desktopBrowserLeaseRequestSchema,
  desktopBrowserScopeSchema,
  desktopBrowserTabRequestSchema
} from '@zana-ai/zcc-server-contract';
import {
  acquireDesktopBrowserControl,
  captureDesktopBrowserTab,
  createDesktopBrowserTab,
  desktopBrowserTabAction,
  DesktopBrowserError,
  importDesktopBrowserCookies,
  listDesktopBrowserImportSources,
  listDesktopBrowserInstances,
  listDesktopBrowserTabs,
  openDesktopBrowserConnection,
  releaseDesktopBrowserControl
} from '../services/desktop-browsers.js';
import { readJsonBody, sendJson } from './json.js';
import type { ProductHttpContext } from './product-context.js';

async function runCommand(response: ServerResponse, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    sendJson(response, 200, await fn());
  } catch (error) {
    const status = error instanceof DesktopBrowserError
      ? error.status
      : typeof (error as { status?: unknown }).status === 'number'
        ? (error as { status: number }).status
        : 400;
    sendJson(response, status, {
      error: error instanceof DesktopBrowserError
        ? error.code
        : error instanceof Error
          ? error.message
          : 'desktop browser failed',
      message: error instanceof Error ? error.message : 'desktop browser failed'
    });
  }
  return true;
}

export async function handleDesktopBrowsersApi(
  request: IncomingMessage,
  response: ServerResponse,
  ctx: ProductHttpContext,
  path: string,
  method: string
): Promise<boolean> {
  if (!path.startsWith('/api/v1/desktop-browsers')) return false;
  if (method !== 'POST') {
    sendJson(response, 405, { error: 'method not allowed' });
    return true;
  }

  let body: unknown = {};
  try {
    body = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { error: 'invalid JSON' });
    return true;
  }

  if (path === '/api/v1/desktop-browsers/instances') {
    const parsed = desktopBrowserHostRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    return runCommand(response, () => listDesktopBrowserInstances(ctx, parsed.data.hostId));
  }

  if (path === '/api/v1/desktop-browsers/tabs') {
    const parsed = desktopBrowserScopeSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    return runCommand(response, () => listDesktopBrowserTabs(ctx, parsed.data));
  }

  if (path === '/api/v1/desktop-browsers/create') {
    const parsed = desktopBrowserCreateRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    return runCommand(response, () => createDesktopBrowserTab(ctx, parsed.data));
  }

  if (path === '/api/v1/desktop-browsers/acquire') {
    const parsed = desktopBrowserAcquireRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    return runCommand(response, () => acquireDesktopBrowserControl(ctx, parsed.data));
  }

  if (path === '/api/v1/desktop-browsers/connection') {
    const parsed = desktopBrowserLeaseRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    response.setHeader('Cache-Control', 'no-store');
    return runCommand(response, () => openDesktopBrowserConnection(ctx, parsed.data));
  }

  if (path === '/api/v1/desktop-browsers/release') {
    const parsed = desktopBrowserLeaseRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    return runCommand(response, () => releaseDesktopBrowserControl(ctx, parsed.data));
  }

  if (path === '/api/v1/desktop-browsers/close' || path === '/api/v1/desktop-browsers/reveal') {
    const parsed = desktopBrowserTabRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    return runCommand(response, () => desktopBrowserTabAction(
      ctx,
      parsed.data,
      path.endsWith('/reveal') ? 'reveal' : 'close'
    ));
  }

  if (path === '/api/v1/desktop-browsers/capture') {
    const parsed = desktopBrowserTabRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    response.setHeader('Cache-Control', 'no-store');
    return runCommand(response, () => captureDesktopBrowserTab(ctx, parsed.data));
  }

  if (path === '/api/v1/desktop-browsers/import-sources') {
    const parsed = desktopBrowserInstanceRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    return runCommand(response, () => listDesktopBrowserImportSources(ctx, parsed.data));
  }

  if (path === '/api/v1/desktop-browsers/import-cookies') {
    const parsed = desktopBrowserImportCookiesRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(response, 400, { error: 'invalid desktop-browser request' });
      return true;
    }
    response.setHeader('Cache-Control', 'no-store');
    return runCommand(response, () => importDesktopBrowserCookies(ctx, parsed.data));
  }

  return false;
}
