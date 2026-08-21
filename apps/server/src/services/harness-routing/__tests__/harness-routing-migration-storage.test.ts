import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  atomicDurableWrite,
  hashBytes,
  MigrationCasError,
  runSerializedMigrationTransaction,
  type DurableWriteFileSystem
} from '../storage.js';

const roots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'harness-routing-storage-'));
  roots.push(value);
  return value;
}

afterEach(() => {
  for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('harness routing migration storage', () => {
  it('writes through a same-directory UUID temp, fsyncs it, renames, then fsyncs the parent', () => {
    const dir = root();
    const target = join(dir, 'config.json');
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

  it('serializes concurrent transactions and keeps queue usable after rejection', async () => {
    const events: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = runSerializedMigrationTransaction(async () => {
      events.push('first:start');
      await gate;
      events.push('first:end');
    });
    const second = runSerializedMigrationTransaction(async () => events.push('second'));
    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    await expect(runSerializedMigrationTransaction(async () => { throw new Error('own failure'); })).rejects.toThrow('own failure');
    await runSerializedMigrationTransaction(async () => events.push('after-failure'));
    expect(events).toEqual(['first:start', 'first:end', 'second', 'after-failure']);
  });

  it('rejects an external edit using a raw-byte SHA-256 expected hash', () => {
    const dir = root();
    const target = join(dir, 'config.json');
    writeFileSync(target, Buffer.from('{"before":true}\n'));

    expect(() => atomicDurableWrite(target, Buffer.from('{"after":true}\n'), {
      expectedHash: hashBytes(Buffer.from('{"different":true}\n'))
    })).toThrow(MigrationCasError);
    expect(readFileSync(target, 'utf8')).toBe('{"before":true}\n');
  });

  it('rejects an external edit that lands after temp fsync but before rename', () => {
    const dir = root();
    const target = join(dir, 'config.json');
    const before = Buffer.from('{"before":true}\n');
    writeFileSync(target, before);

    expect(() => atomicDurableWrite(target, Buffer.from('{"after":true}\n'), {
      expectedHash: hashBytes(before),
      beforeRename: () => writeFileSync(target, '{"external":true}\n')
    })).toThrow(MigrationCasError);
    expect(readFileSync(target, 'utf8')).toBe('{"external":true}\n');
    expect(readdirSync(dir)).toEqual(['config.json']);
  });

  it('removes its temp file when a write fails', () => {
    const dir = root();
    const target = join(dir, 'config.json');
    writeFileSync(target, 'old');

    expect(() => atomicDurableWrite(target, Buffer.from('new'), {
      expectedHash: hashBytes(Buffer.from('old')),
      beforeRename: () => { throw new Error('crash'); }
    })).toThrow('crash');
    expect(readFileSync(target, 'utf8')).toBe('old');
    expect(readdirSync(dir)).toEqual(['config.json']);
  });
});
