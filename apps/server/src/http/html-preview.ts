import type { IncomingMessage, ServerResponse } from 'node:http';
import { FILE_RANGE_MAX_BYTES } from '@zana-ai/zcc-domain';
import type { ProductHttpContext } from './product-context.js';
import { ProjectFsError } from './project-fs-via-host.js';
import { previewFileReader, previewFileSize } from './video-preview.js';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';

export const HTML_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The document gets its own policy instead of inheriting the app's (as srcdoc
 * and blob: frames do), so inline and CDN scripts run. `sandbox` keeps it in an
 * opaque origin even when opened top-level: no app storage, and product API
 * calls carry `Origin: null`, which the origin guard rejects.
 */
export const HTML_PREVIEW_CSP = [
  'sandbox allow-scripts allow-forms allow-modals',
  "default-src * data: blob: 'unsafe-inline' 'unsafe-eval'"
].join('; ');

export function isHtmlPreviewFile(path: string): boolean {
  return /\.html?$/i.test(path);
}

/** Origin-guarded by product HTTP. Reads the confined file in bounded host reads. */
export async function sendHtmlPreview(
  request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, params: URLSearchParams
): Promise<void> {
  try {
    await sendHtmlDocument(request, response, ctx, params);
  } catch (error) {
    const status = error instanceof ProjectFsError ? error.status
      : error instanceof HostUnavailableError ? 503
        : error instanceof AmbiguousHostError ? 409 : 500;
    const message = status === 413 ? 'This HTML file exceeds the 20 MB preview limit.'
      : status === 404 ? 'The file may have been moved or deleted.'
        : status === 403 ? 'This file is not available in this preview.'
          : status === 409 ? 'The file changed or its host could not be selected. Try again.'
            : status === 503 ? 'The project host is unavailable. Reconnect and try again.'
              : 'The file could not be loaded. Try again when it is available.';
    // Use fixed copy: host errors can contain paths or untrusted file names.
    const body = Buffer.from(`<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Could not open this preview</title>
<style>
:root{color-scheme:light dark;font-family:system-ui,sans-serif;background:Canvas;color:CanvasText}
body{box-sizing:border-box;min-height:100vh;margin:0;padding:32px 24px;display:grid;place-content:center;text-align:center}
h1{font-size:14px;font-weight:600}p{max-width:36ch;font-size:12px;line-height:1.6;color:GrayText}
button{justify-self:center;margin-top:8px;padding:6px 12px;border:1px solid GrayText;border-radius:6px;background:Canvas;color:CanvasText;cursor:pointer}
</style><body><h1>Could not open this preview</h1><p>${message}</p>
<button type="button" onclick="if(parent===window)location.reload();else parent.postMessage({type:'zcc:html-preview:retry'},'*')">Try again</button></body></html>`);
    response.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(body.length),
      'content-security-policy': HTML_PREVIEW_CSP,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  }
}

async function sendHtmlDocument(
  request: IncomingMessage, response: ServerResponse, ctx: ProductHttpContext, params: URLSearchParams
): Promise<void> {
  if (!isHtmlPreviewFile(params.get('path') ?? '')) {
    throw new ProjectFsError(415, 'unsupported-html', 'unsupported HTML file type');
  }
  // Frames can omit Origin. Never let a foreign page embed local files.
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new ProjectFsError(403, 'foreign-origin', 'HTML preview must be opened from the app');
  }
  const read = previewFileReader(ctx, params);
  const size = await previewFileSize(read, 'html');
  if (size > HTML_PREVIEW_MAX_BYTES) {
    throw new ProjectFsError(413, 'html-too-large', 'HTML file is too large to preview');
  }
  const chunks: Buffer[] = [];
  for (let offset = 0; offset < size;) {
    const length = Math.min(FILE_RANGE_MAX_BYTES, size - offset);
    const result = await read(offset, length);
    const bytes = Buffer.from(result.content, 'base64');
    if (result.encoding !== 'base64' || result.totalBytes !== size || bytes.length !== length) {
      throw new ProjectFsError(409, 'html-changed', 'HTML file changed while reading');
    }
    chunks.push(bytes);
    offset += length;
  }
  const body = Buffer.concat(chunks);
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': String(body.length),
    'content-security-policy': HTML_PREVIEW_CSP,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer'
  });
  response.end(request.method === 'HEAD' ? undefined : body);
}
