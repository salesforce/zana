import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  atomicDurableWrite,
  createSerializedTransactionQueue,
  durableRemove,
  DurableWriteConflictError,
  hashBytes,
  readRawFile,
  type DurableWriteFileSystem
} from './durable-store.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'zcc-server-durable-store-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('durable store', () => {
  it('writes through a same-directory UUID temp, fsyncs it, renames, then fsyncs the parent', () => {
    const dir = root();
    const target = join(dir, 'store.json');
    const calls: string[] = [];
    const handles = new Map<number, string>();
    let nextFd = 10;
    const fs: DurableWriteFileSystem = {
      readFile: () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
      open: (path, _flags, mode) => {
        calls.push(`open:${path}${mode === undefined ? '' : `:${mode.toString(8)}`}`);
        const fd = nextFd++;
        handles.set(fd, path);
        return fd;
      },
      writeFile: (fd, bytes) => calls.push(`write:${handles.get(fd)}:${bytes.toString('utf8')}`),
      fsync: (fd) => calls.push(`fsync:${handles.get(fd)}`),
      close: (fd) => calls.push(`close:${handles.get(fd)}`),
      rename: (from, to) => calls.push(`rename:${from}:${to}`),
      unlink: (path) => calls.push(`unlink:${path}`)
    };

    atomicDurableWrite(target, Buffer.from('new'), { fs, uuid: () => 'fixed-id' });

    const temp = `${target}.tmp-fixed-id`;
    expect(calls).toEqual([
      `open:${temp}:600`,
      `write:${temp}:new`,
      `fsync:${temp}`,
      `close:${temp}`,
      `rename:${temp}:${target}`,
      `open:${dir}`,
      `fsync:${dir}`,
      `close:${dir}`
    ]);
  });

  it('serializes concurrent transactions on an independent queue and stays usable after rejection', async () => {
    const events: string[] = [];
    const queue = createSerializedTransactionQueue();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = queue.run(async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
    });
    const second = queue.run(async () => { events.push('second'); });
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    await expect(queue.run(async () => { throw new Error('own failure'); })).rejects.toThrow('own failure');
    await queue.run(async () => { events.push('after-failure'); });
    expect(events).toEqual(['first:start', 'first:end', 'second', 'after-failure']);
  });

  it('rejects an external edit using a raw-byte SHA-256 expected hash', () => {
    const dir = root();
    const target = join(dir, 'store.json');
    writeFileSync(target, Buffer.from('{"before":true}\n'));

    expect(() => atomicDurableWrite(target, Buffer.from('{"after":true}\n'), {
      expectedHash: hashBytes(Buffer.from('{"different":true}\n'))
    })).toThrow(DurableWriteConflictError);
    expect(readFileSync(target, 'utf8')).toBe('{"before":true}\n');
  });

  it('rejects an external edit that lands after temp fsync but before rename', () => {
    const dir = root();
    const target = join(dir, 'store.json');
    const before = Buffer.from('{"before":true}\n');
    writeFileSync(target, before);

    expect(() => atomicDurableWrite(target, Buffer.from('{"after":true}\n'), {
      expectedHash: hashBytes(before),
      beforeRename: () => writeFileSync(target, '{"external":true}\n')
    })).toThrow(DurableWriteConflictError);
    expect(readFileSync(target, 'utf8')).toBe('{"external":true}\n');
    expect(readdirSync(dir)).toEqual(['store.json']);
  });

  it('removes its temp file when a write fails', () => {
    const dir = root();
    const target = join(dir, 'store.json');
    writeFileSync(target, 'old');

    expect(() => atomicDurableWrite(target, Buffer.from('new'), {
      expectedHash: hashBytes(Buffer.from('old')),
      beforeRename: () => { throw new Error('crash'); }
    })).toThrow('crash');
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['store.json']);
  });

  it('durableRemove deletes only on a matching hash and fsyncs the parent directory', () => {
    const dir = root();
    const target = join(dir, 'store.json');
    const bytes = Buffer.from('{"gone":true}\n');
    writeFileSync(target, bytes);

    expect(() => durableRemove(target, { expectedHash: hashBytes(Buffer.from('mismatch')) }))
      .toThrow(DurableWriteConflictError);
    expect(readdirSync(dir)).toEqual(['store.json']);

    durableRemove(target, { expectedHash: hashBytes(bytes) });
    expect(readdirSync(dir)).toEqual([]);
  });

  it('readRawFile returns null for an absent file and the exact bytes otherwise', () => {
    const dir = root();
    const target = join(dir, 'store.json');
    expect(readRawFile(target)).toBeNull();
    writeFileSync(target, 'contents');
    expect(readRawFile(target)?.toString('utf8')).toBe('contents');
  });
});
