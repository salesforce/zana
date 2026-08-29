import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { sendHostArtifactFile } from './host-artifact-response.js';

function capture(): { response: ServerResponse; status: number; headers: Record<string, string>; chunks: Buffer[] } {
  const captured = { status: 0, headers: {} as Record<string, string>, chunks: [] as Buffer[] };
  const stream = new PassThrough();
  stream.on('data', (chunk: Buffer) => {
    captured.chunks.push(Buffer.from(chunk));
  });
  const response = Object.assign(stream, {
    writeHead(status: number, headers?: Record<string, string>) {
      captured.status = status;
      captured.headers = headers ?? {};
      return response;
    }
  }) as unknown as ServerResponse;
  return Object.assign(captured, { response });
}

describe('sendHostArtifactFile', () => {
  it('returns false when the file is missing or the size disagrees', async () => {
    const captured = capture();
    expect(
      await sendHostArtifactFile(captured.response, {
        path: '/tmp/zcc-missing-host-artifact.js',
        byteLength: 12,
        digest: 'ab'.repeat(32)
      })
    ).toBe(false);

    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-file-'));
    const path = join(dir, 'host.js');
    await writeFile(path, 'export default 1;\n');
    expect(
      await sendHostArtifactFile(captured.response, {
        path,
        byteLength: 1,
        digest: 'ab'.repeat(32)
      })
    ).toBe(false);
  });

  it('sends headers only for HEAD', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-head-'));
    const path = join(dir, 'host.js');
    const bytes = Buffer.from('export default 1;\n');
    await writeFile(path, bytes);
    const captured = capture();
    expect(
      await sendHostArtifactFile(captured.response, {
        path,
        byteLength: bytes.byteLength,
        digest: 'ab'.repeat(32),
        headOnly: true
      })
    ).toBe(true);
    expect(captured.status).toBe(200);
    expect(captured.headers['content-length']).toBe(String(bytes.byteLength));
    expect(Buffer.concat(captured.chunks).length).toBe(0);
  });

  it('streams the file for GET', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'zcc-host-get-'));
    const path = join(dir, 'host.js');
    const bytes = Buffer.from('export default 2;\n');
    await writeFile(path, bytes);
    const captured = capture();
    expect(
      await sendHostArtifactFile(captured.response, {
        path,
        byteLength: bytes.byteLength,
        digest: 'cd'.repeat(32)
      })
    ).toBe(true);
    expect(captured.status).toBe(200);
    expect(Buffer.concat(captured.chunks).equals(bytes)).toBe(true);
  });
});
