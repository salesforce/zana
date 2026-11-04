import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FILE_RANGE_MAX_BYTES } from '@zana-ai/zcc-domain';
import { readConfinedFileRange } from './read-file-range.js';

let base: string;
let root: string;
beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'range-')));
  root = join(base, 'root');
  mkdirSync(root);
  writeFileSync(join(root, 'f.bin'), 'abcdefghij');
  writeFileSync(join(base, 'secret.txt'), 'secret');
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

const decode = (r: { content: string }) => Buffer.from(r.content, 'base64').toString();

describe('readConfinedFileRange', () => {
  it('reads a byte window and reports total size', async () => {
    const r = await readConfinedFileRange(root, 'f.bin', 2, 4);
    expect(decode(r)).toBe('cdef');
    expect(r).toMatchObject({ encoding: 'base64', totalBytes: 10 });
  });
  it('clamps at EOF and returns empty past the end', async () => {
    expect(decode(await readConfinedFileRange(root, 'f.bin', 8, 100))).toBe('ij');
    expect(decode(await readConfinedFileRange(root, 'f.bin', 50, 5))).toBe('');
  });
  it.each([[-1, 1], [1.5, 1], [0, -1], [0, 0.5], [0, FILE_RANGE_MAX_BYTES + 1], [Number.NaN, 1]])(
    'rejects invalid range offset=%s length=%s', async (offset, length) => {
      await expect(readConfinedFileRange(root, 'f.bin', offset, length)).rejects.toMatchObject({ code: 'invalid-range' });
    });
  it('fails closed for missing files, directories, traversal and escaping symlinks', async () => {
    mkdirSync(join(root, 'dir'));
    symlinkSync(join(base, 'secret.txt'), join(root, 'link'));
    for (const rel of ['missing', 'dir', '../secret.txt', 'link']) {
      await expect(readConfinedFileRange(root, rel, 0, 5)).rejects.toMatchObject({ code: 'path_not_found' });
    }
  });
  it('follows a symlink that stays inside the root', async () => {
    symlinkSync(join(root, 'f.bin'), join(root, 'inner'));
    expect(decode(await readConfinedFileRange(root, 'inner', 0, 3))).toBe('abc');
  });
});
