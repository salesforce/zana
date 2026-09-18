import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FILE_RANGE_MAX_BYTES, videoContentType } from '@zana-ai/zcc-domain';
import { readConfinedFileRange } from '@zana-ai/zcc-host-daemon/read-file-range';
import { HostReadFileCommandSchema, HostReadFileResultSchema } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from './product-context.js';
import { sendVideoPreview, videoByteRange } from './video-preview.js';

vi.mock('@zana-ai/zcc-db', () => ({ getConversationThread: vi.fn(), getEnvironment: vi.fn() }));
import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';

describe('video byte ranges and types', () => {
  it('recognizes video extensions case-insensitively without accepting inherited keys', () => {
    for (const ext of ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'ogg', 'mkv']) {
      expect(videoContentType(`C:\\clips\\a.${ext.toUpperCase()}`)).toMatch(/^video\//);
    }
    for (const path of ['', 'a.txt', 'a.constructor', 'a.mp4/README']) expect(videoContentType(path)).toBeNull();
  });
  it('parses normal, open-ended, suffix, empty, clamped, and invalid ranges', () => {
    expect(videoByteRange(undefined, 10)).toEqual({ start: 0, end: 9 });
    expect(videoByteRange(undefined, 0)).toEqual({ start: 0, end: -1 });
    expect(videoByteRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 });
    expect(videoByteRange('bytes=2-', 10)).toEqual({ start: 2, end: 9 });
    expect(videoByteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(videoByteRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
    expect(videoByteRange('bytes=2-20', 10)).toEqual({ start: 2, end: 9 });
    for (const range of ['bytes=-0', 'bytes=-', 'bytes=10-', 'bytes=5-2', 'bytes=0-1,4-5', 'oops', 'bytes=99999999999999999-']) {
      expect(videoByteRange(range, 10)).toBeNull();
    }
    expect(videoByteRange('bytes=0-', 0)).toBeNull();
  });
  it('validates bounded RPC reads and returned file sizes', () => {
    const command = { type: 'host.read_file', root: '/project', relPath: 'a.mp4', byteRange: { offset: 10, length: 100 } };
    expect(HostReadFileCommandSchema.parse(command)).toEqual(command);
    for (const byteRange of [{ offset: -1, length: 1 }, { offset: 0, length: FILE_RANGE_MAX_BYTES + 1 }, { offset: 0.5, length: 1 }]) {
      expect(HostReadFileCommandSchema.safeParse({ ...command, byteRange }).success).toBe(false);
    }
    expect(HostReadFileResultSchema.parse({ content: '', encoding: 'base64', totalBytes: 123 })).toHaveProperty('totalBytes', 123);
  });
});

describe('video HTTP streaming', () => {
  let root: string;
  let server: Server;
  let base: string;
  let ctx: ProductHttpContext;
  const bytes = Buffer.alloc(FILE_RANGE_MAX_BYTES * 2 + 17, 0x67);
  const rpc = vi.fn();
  const url = (path: string, extra: Record<string, string> = {}) => `${base}?${new URLSearchParams({ path, ...extra })}`;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'video-preview-'));
    await writeFile(join(root, 'large.mp4'), bytes);
    vi.mocked(getConversationThread).mockReturnValue({ id: 't1', projectId: 'p1', environmentId: 'e1', hostId: 'host1' } as never);
    vi.mocked(getEnvironment).mockReturnValue({ path: root } as never);
    rpc.mockReset().mockImplementation(({ command }) => readConfinedFileRange(command.root, command.relPath, command.byteRange.offset, command.byteRange.length));
    ctx = {
      db: {}, dataDir: root,
      toProjects: () => [{ id: 'p1', path: root }],
      hostHub: { resolveHostId: () => 'host1', callHostOnlineRpc: rpc }
    } as unknown as ProductHttpContext;
    server = createServer((req, res) => {
      void sendVideoPreview(req, res, ctx, new URL(req.url!, 'http://localhost').searchParams).catch((error) => {
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
  it('streams a file larger than the text cap in bounded host reads and supports seeks', async () => {
    const response = await fetch(url(join(root, 'large.mp4')));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('video/mp4');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
    expect(rpc.mock.calls.map(([call]) => call.command.byteRange.length)).toEqual([0, FILE_RANGE_MAX_BYTES, FILE_RANGE_MAX_BYTES, 17]);
    const range = await fetch(url('large.mp4', { threadId: 't1' }), { headers: { Range: `bytes=${FILE_RANGE_MAX_BYTES}-` } });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe(`bytes ${FILE_RANGE_MAX_BYTES}-${bytes.length - 1}/${bytes.length}`);
    expect(Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(FILE_RANGE_MAX_BYTES))).toBe(true);
    expect(rpc.mock.calls.at(-1)?.[0].hostId).toBe('host1');
    const suffix = await fetch(url('large.mp4', { threadId: 't1' }), { headers: { Range: 'bytes=-5' } });
    expect(Buffer.from(await suffix.arrayBuffer())).toEqual(bytes.subarray(-5));
  });
  it('serves HEAD and rejects unsatisfiable ranges without reading content', async () => {
    const head = await fetch(url(join(root, 'large.mp4')), { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    expect(rpc).toHaveBeenCalledTimes(1);
    const invalid = await fetch(url(join(root, 'large.mp4')), { headers: { Range: 'bytes=99999999-' } });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get('content-range')).toBe(`bytes */${bytes.length}`);
  });
  it('reads server thread storage and attachments without contacting the host', async () => {
    for (const dir of ['thread-storage/t1', 'attachments/p1']) {
      await mkdir(join(root, dir), { recursive: true });
      await writeFile(join(root, dir, 'clip.webm'), 'video');
    }
    const storage = await fetch(url('clip.webm', { threadId: 't1', source: 'thread-storage' }));
    expect(await storage.text()).toBe('video');
    vi.mocked(getEnvironment).mockReturnValue(null);
    const attachment = await fetch(url(join(root, 'attachments/p1/clip.webm'), { threadId: 't1' }));
    expect(await attachment.text()).toBe('video');
    expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects missing files, traversal, symlink escapes, directories and unauthorized roots', async () => {
    await symlink(tmpdir(), join(root, 'escape'));
    await mkdir(join(root, 'dir.mp4'));
    for (const [path, status, extra] of [
      ['/unregistered/clip.mp4', 403, {}],
      ['../clip.mp4', 403, { threadId: 't1' }],
      ['escape/clip.mp4', 404, { threadId: 't1' }],
      ['missing.mp4', 404, { threadId: 't1' }],
      ['dir.mp4', 404, { threadId: 't1' }],
      ['clip.mp4', 400, { source: 'thread-storage' }],
      ['clip.mp4', 400, { source: 'unknown' }],
      ['clip.mp4', 400, { threadId: '../t1' }],
      ['clip.mp4', 400, { threadId: '..' }],
      ['notes.txt', 415, {}]
    ] as const) expect((await fetch(url(path, extra))).status, path).toBe(status);
    vi.mocked(getConversationThread).mockReturnValue(null);
    expect((await fetch(url('clip.mp4', { threadId: 'missing' }))).status).toBe(404);
  });
  it('rejects unavailable environments, foreign embeds and old hosts', async () => {
    vi.mocked(getEnvironment).mockReturnValue(null);
    expect((await fetch(url('clip.mp4', { threadId: 't1' }))).status).toBe(409);
    expect((await fetch(url(join(root, 'large.mp4')), { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    rpc.mockResolvedValue({ content: '', encoding: 'utf8' });
    expect((await fetch(url(join(root, 'large.mp4')))).status).toBe(502);
    rpc.mockRejectedValue(new Error('host offline'));
    expect((await fetch(url(join(root, 'large.mp4')))).status).toBe(500);
  });
  it('handles empty files and terminates a stream if its file changes', async () => {
    await writeFile(join(root, 'empty.mp4'), '');
    const empty = await fetch(url(join(root, 'empty.mp4')));
    expect(empty.status).toBe(200);
    expect(await empty.text()).toBe('');
    rpc.mockResolvedValueOnce({ content: '', encoding: 'base64', totalBytes: 10 })
      .mockResolvedValue({ content: '', encoding: 'base64', totalBytes: 0 });
    await expect(fetch(url(join(root, 'large.mp4'))).then((res) => res.arrayBuffer())).rejects.toThrow();
  });
  it('bounds direct reads, handles EOF, and rechecks confinement for each read', async () => {
    for (const [offset, length] of [[-1, 0], [0, -1], [0, FILE_RANGE_MAX_BYTES + 1], [0.5, 1]]) {
      await expect(readConfinedFileRange(root, 'large.mp4', offset, length)).rejects.toMatchObject({ code: 'invalid-range' });
    }
    expect(await readConfinedFileRange(root, 'large.mp4', bytes.length + 10, 100)).toMatchObject({ content: '', totalBytes: bytes.length });
    await expect(readConfinedFileRange(root, '../secret.mp4', 0, 1)).rejects.toMatchObject({ code: 'path_not_found' });
  });
});
