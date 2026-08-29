import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FILE_ATTACHMENT_LIMIT_BYTES,
  IMAGE_ATTACHMENT_LIMIT_BYTES,
  hostPromptFromInput,
  pathLooksRuntimeReadable,
  readAttachment,
  resolvePromptAttachmentPath,
  storeAttachment
} from './attachments.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-attachments-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
});

describe('project attachments', () => {
  it('stores an image upload and reads it back from the confined directory', async () => {
    const dataDir = await makeTempDir();
    const stored = await storeAttachment(dataDir, 'proj-1', {
      name: 'shot.png',
      type: 'image/png',
      size: 4,
      arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer
    });
    expect(stored.type).toBe('localImage');
    expect(stored.name).toBe('shot.png');
    expect(stored.path).toMatch(/^shot-\d+-[a-z0-9]+\.png$/u);

    const read = await readAttachment(dataDir, 'proj-1', stored.path);
    expect(read.content.equals(Buffer.from([1, 2, 3, 4]))).toBe(true);
    expect(read.mimeType).toBe('image/png');
  });

  it('refuses HEIC uploads and path escape', async () => {
    const dataDir = await makeTempDir();
    await expect(storeAttachment(dataDir, 'proj-1', {
      name: 'photo.heic',
      type: 'image/heic',
      size: 2,
      arrayBuffer: async () => new Uint8Array([1, 2]).buffer
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/HEIC/) });

    const dir = join(dataDir, 'attachments', 'proj-1');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'ok.png'), 'x');
    await expect(readAttachment(dataDir, 'proj-1', '../secret.png')).rejects.toMatchObject({
      status: 400
    });
  });

  it('resolves relative attachment refs against the project store and passes absolute paths through', () => {
    expect(pathLooksRuntimeReadable('/tmp/shot.png')).toBe(true);
    expect(pathLooksRuntimeReadable('shot-1.png')).toBe(false);
    const dataDir = '/data';
    expect(resolvePromptAttachmentPath(dataDir, 'p1', '/tmp/a.png')).toBe('/tmp/a.png');
    expect(resolvePromptAttachmentPath(dataDir, 'p1', 'shot.png')).toBe(join(dataDir, 'attachments', 'p1', 'shot.png'));
  });

  it('appends disk markers for local images onto the host prompt', () => {
    expect(hostPromptFromInput(
      [
        { type: 'text', text: 'look' },
        { type: 'localImage', path: 'shot.png' }
      ],
      ['look'],
      (path) => `/data/attachments/p1/${path}`
    )).toEqual([
      'look',
      '[Attached image. It is on disk at /data/attachments/p1/shot.png — use the Read tool to view it.]'
    ]);
    expect(hostPromptFromInput([{ type: 'localImage', path: '/tmp/a.png' }], [], (path) => path)).toEqual([
      '[Attached image. It is on disk at /tmp/a.png — use the Read tool to view it.]'
    ]);
    expect(hostPromptFromInput(
      [{ type: 'localFile', path: '/tmp/a.pdf', name: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 12 }],
      ['see file'],
      (path) => path
    )).toEqual([
      'see file',
      '[Attached file "a.pdf" (application/pdf, 12 bytes). It is on disk at /tmp/a.pdf — use the Read tool to view it.]'
    ]);
    expect(hostPromptFromInput([{ type: 'localImage', path: 'shot.png' }], ['look'])).toEqual(['look']);
    expect(hostPromptFromInput(null, ['  ', 'keep'])).toEqual(['keep']);
    expect(hostPromptFromInput(
      [{ type: 'localFile', path: '/tmp/a.bin' }, { type: 'localImage', path: '' }, 'skip', { type: 'text', text: 'x' }],
      [],
      (path) => path
    )).toEqual([
      '[Attached file. It is on disk at /tmp/a.bin — use the Read tool to view it.]'
    ]);
  });

  it('stores non-image files, sanitizes names, and refuses empty or oversized uploads', async () => {
    const dataDir = await makeTempDir();
    const stored = await storeAttachment(dataDir, 'proj-1', {
      name: 'notes 1.pdf',
      type: 'application/pdf',
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer
    });
    expect(stored.type).toBe('localFile');
    expect(stored.path).toMatch(/^notes-1-\d+-[a-z0-9]+\.pdf$/u);

    await expect(storeAttachment(dataDir, 'proj-1', {
      name: '   ',
      type: 'image/png',
      size: 1,
      arrayBuffer: async () => new Uint8Array([1]).buffer
    })).rejects.toMatchObject({ status: 400 });

    await expect(storeAttachment(dataDir, 'proj-1', {
      name: 'huge.png',
      type: 'image/png',
      size: IMAGE_ATTACHMENT_LIMIT_BYTES + 1,
      arrayBuffer: async () => new Uint8Array([1]).buffer
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/10MB/) });

    await expect(storeAttachment(dataDir, 'proj-1', {
      name: 'huge.bin',
      type: 'application/octet-stream',
      size: FILE_ATTACHMENT_LIMIT_BYTES + 1,
      arrayBuffer: async () => new Uint8Array([1]).buffer
    })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/25MB/) });

    await expect(readAttachment(dataDir, 'proj-1', 'missing.png')).rejects.toMatchObject({ status: 404 });
    expect(pathLooksRuntimeReadable('file:///tmp/a.png')).toBe(true);
    expect(pathLooksRuntimeReadable('C:\\tmp\\a.png')).toBe(true);
  });
});
