import type { IncomingMessage, ServerResponse } from 'node:http';
import { FILE_RANGE_MAX_BYTES } from '@zana-ai/zcc-domain';
import type { ProductHttpContext } from './product-context.js';
import { ProjectFsError } from './project-fs-via-host.js';
import { previewFileReader, previewFileSize } from './video-preview.js';

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
