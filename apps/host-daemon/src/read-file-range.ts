import { open } from 'node:fs/promises';
import { resolveContainedReal } from '@zana-ai/zcc-path-confine';
import { FILE_RANGE_MAX_BYTES } from '@zana-ai/zcc-domain';
import { HostCommandError } from './host-command-error.js';

/** Confine every read, including subsequent seeks; never buffer a whole video. */
export async function readConfinedFileRange(root: string, relPath: string, offset: number, length: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length)
    || length < 0 || length > FILE_RANGE_MAX_BYTES) {
    throw new HostCommandError('invalid-range', 'invalid file byte range');
  }
  const real = await resolveContainedReal(root, relPath);
  if (!real) throw new HostCommandError('path_not_found', 'file not found');
  const file = await open(real, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new HostCommandError('path_not_found', 'not a file');
    const buffer = Buffer.alloc(Math.min(length, Math.max(0, stat.size - offset)));
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await file.read(buffer, read, buffer.length - read, offset + read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    return { content: buffer.subarray(0, read).toString('base64'), encoding: 'base64' as const, totalBytes: stat.size };
  } finally {
    await file.close();
  }
}
