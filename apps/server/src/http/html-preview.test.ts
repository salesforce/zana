import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_RANGE_MAX_BYTES } from '@zana-ai/zcc-domain';
import { readConfinedFileRange } from '@zana-ai/zcc-host-daemon/read-file-range';
import type { ProductHttpContext } from './product-context.js';
import { HTML_PREVIEW_CSP, HTML_PREVIEW_MAX_BYTES, isHtmlPreviewFile, sendHtmlPreview } from './html-preview.js';

vi.mock('@zana-ai/zcc-db', () => ({ getConversationThread: vi.fn(), getEnvironment: vi.fn(), getPrimaryHost: () => ({ id: 'host1' }) }));
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';

describe('HTML preview policy', () => {
  it('recognizes .html and .htm only', () => {
    expect(isHtmlPreviewFile('a/Page.HTML')).toBe(true);
    expect(isHtmlPreviewFile('page.htm')).toBe(true);
    for (const path of ['', 'page.md', 'page.html/x', 'page.xhtml.txt']) expect(isHtmlPreviewFile(path)).toBe(false);
  });
  it('sandboxes the document while allowing inline and remote scripts', () => {
    expect(HTML_PREVIEW_CSP).toContain('sandbox allow-scripts');
    expect(HTML_PREVIEW_CSP).not.toContain('allow-same-origin');
    expect(HTML_PREVIEW_CSP).toContain("'unsafe-inline'");
  });
});

describe('HTML preview HTTP', () => {
  let root: string;
  let server: Server;
  let base: string;
  let ctx: ProductHttpContext;
  const rpc = vi.fn();
  const url = (path: string, extra: Record<string, string> = {}) => `${base}?${new URLSearchParams({ path, ...extra })}`;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'html-preview-'));
    await writeFile(join(root, 'page.html'), '<script>document.title = "ran"</script><h1>é</h1>');
    vi.mocked(getConversationThread).mockReturnValue({ id: 't1', projectId: 'p1', environmentId: 'e1', hostId: 'host1' } as never);
    vi.mocked(getEnvironment).mockReturnValue({ path: root } as never);
    rpc.mockReset().mockImplementation(({ command }) => readConfinedFileRange(command.root, command.relPath, command.byteRange.offset, command.byteRange.length));
    ctx = {
      db: {}, dataDir: root,
      toProjects: () => [{ id: 'p1', path: root }],
      hostHub: { resolveHostId: () => 'host1', callHostOnlineRpc: rpc }
    } as unknown as ProductHttpContext;
    server = createServer((req, res) => {
      void sendHtmlPreview(req, res, ctx, new URL(req.url!, 'http://localhost').searchParams).catch((error) => {
        res.writeHead(error.status ?? 500, { 'content-type': 'application/json' }).end(JSON.stringify({ message: error.message }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  });
  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  });

  it('serves the file with its own sandboxing CSP instead of the app policy', async () => {
    const response = await fetch(url('page.html', { threadId: 't1' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toBe(HTML_PREVIEW_CSP);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.text()).toBe('<script>document.title = "ran"</script><h1>é</h1>');
    expect(rpc.mock.calls[0]?.[0].hostId).toBe('host1');
  });

  it('reads files larger than one host read in bounded chunks and answers HEAD without a body', async () => {
    const bytes = Buffer.alloc(FILE_RANGE_MAX_BYTES + 9, 0x61);
    await writeFile(join(root, 'big.html'), bytes);
    const response = await fetch(url(join(root, 'big.html')));
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    expect(rpc.mock.calls.map(([call]) => call.command.byteRange.length)).toEqual([0, FILE_RANGE_MAX_BYTES, 9]);
    const head = await fetch(url(join(root, 'big.html')), { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
  });

  it('serves thread storage without contacting the host', async () => {
    await mkdir(join(root, 'thread-storage/t1'), { recursive: true });
    await writeFile(join(root, 'thread-storage/t1/out.htm'), '<p>stored</p>');
    expect(await (await fetch(url('out.htm', { threadId: 't1', source: 'thread-storage' }))).text()).toBe('<p>stored</p>');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects other types, foreign embeds, escapes, missing and oversized files', async () => {
    expect((await fetch(url('notes.txt', { threadId: 't1' }))).status).toBe(415);
    expect((await fetch(url('page.html', { threadId: 't1' }), { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await fetch(url('../page.html', { threadId: 't1' }))).status).toBe(403);
    expect((await fetch(url('/unregistered/page.html'))).status).toBe(403);
    expect((await fetch(url('missing.html', { threadId: 't1' }))).status).toBe(404);
    rpc.mockResolvedValueOnce({ content: '', encoding: 'base64', totalBytes: HTML_PREVIEW_MAX_BYTES + 1 });
    expect((await fetch(url('page.html', { threadId: 't1' }))).status).toBe(413);
  });

  it('fails when the file changes mid-read or the host is too old', async () => {
    rpc.mockResolvedValueOnce({ content: '', encoding: 'base64', totalBytes: 4 })
      .mockResolvedValueOnce({ content: Buffer.from('ab').toString('base64'), encoding: 'base64', totalBytes: 4 });
    expect((await fetch(url('page.html', { threadId: 't1' }))).status).toBe(409);
    rpc.mockResolvedValueOnce({ content: '', encoding: 'utf8' });
    expect((await fetch(url('page.html', { threadId: 't1' }))).status).toBe(502);
  });
});
