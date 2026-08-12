import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, chmod, readFile, realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadToRemote, downloadFromRemote } from '../remote-transfer.js';
import type { ProjectRemote } from '../../shared/types.js';

// Same trick as remote-fs.test.ts: a fake `ssh` on PATH that discards its -o
// options + target and runs the final argument (the remote command) via
// `sh -c`, with stdin passed through. This exercises the REAL streamed
// upload/download commands (cat>tmp+mv, collision loop, test -f guard) against
// a real filesystem — no mocks.
describe('remote-transfer over a fake ssh', () => {
  let binDir: string;
  let remoteDir: string; // stands in for the devbox filesystem (the "root")
  let localDir: string; // local machine scratch
  let prevPath: string | undefined;
  const remote: ProjectRemote = { host: 'fake-host' };
  let root: string;

  beforeEach(async () => {
    binDir = await mkdtemp(join(tmpdir(), 'rt-bin-'));
    remoteDir = await mkdtemp(join(tmpdir(), 'rt-remote-'));
    localDir = await mkdtemp(join(tmpdir(), 'rt-local-'));
    root = await realpath(remoteDir);
    const fakeSsh = join(binDir, 'ssh');
    await writeFile(
      fakeSsh,
      ['#!/bin/sh', 'eval "cmd=\\${$#}"', 'exec sh -c "$cmd"', ''].join('\n'),
      'utf8'
    );
    await chmod(fakeSsh, 0o755);
    prevPath = process.env.PATH;
    process.env.PATH = `${binDir}:${process.env.PATH ?? ''}`;
  });

  afterEach(async () => {
    if (prevPath !== undefined) process.env.PATH = prevPath;
    await rm(binDir, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
    await rm(localDir, { recursive: true, force: true });
  });

  it('uploads a local file into <destDir>/.zcc-uploads/', async () => {
    const local = join(localDir, 'note.txt');
    await writeFile(local, 'hello remote');
    const res = await uploadToRemote(remote, root, local, root);
    expect(res.ok).toBe(true);
    expect(res.bytes).toBe(12);
    expect(res.path).toBe(join(root, '.zcc-uploads', 'note.txt'));
    expect(await readFile(res.path!, 'utf8')).toBe('hello remote');
    // No temp file left behind.
    expect(existsSync(`${res.path}.zcc-tmp.$$`)).toBe(false);
  });

  it('uploads into the remote root when the terminal provides a relative cwd', async () => {
    const local = join(localDir, 'relative.txt');
    await writeFile(local, 'relative root');

    const res = await uploadToRemote(remote, root, local, '.');

    expect(res).toMatchObject({ ok: true, path: join(root, '.zcc-uploads', 'relative.txt') });
    expect(await readFile(res.path!, 'utf8')).toBe('relative root');
  });

  it('accepts an absolute project subdirectory as an upload destination', async () => {
    const local = join(localDir, 'nested.txt');
    const dest = join(root, 'nested');
    await mkdir(dest);
    await writeFile(local, 'nested destination');

    const res = await uploadToRemote(remote, root, local, dest);

    expect(res).toMatchObject({ ok: true, path: join(dest, '.zcc-uploads', 'nested.txt') });
    expect(await readFile(res.path!, 'utf8')).toBe('nested destination');
  });

  it('uploads binary content byte-for-byte', async () => {
    const local = join(localDir, 'blob.bin');
    const bytes = Buffer.from([0x00, 0xff, 0x10, 0x00, 0x42]);
    await writeFile(local, bytes);
    const res = await uploadToRemote(remote, root, local, root);
    expect(res.ok).toBe(true);
    expect(Buffer.from(await readFile(res.path!))).toEqual(bytes);
  });

  it('suffixes the name on collision rather than overwriting', async () => {
    const local = join(localDir, 'dup.txt');
    await writeFile(local, 'first');
    const a = await uploadToRemote(remote, root, local, root);
    await writeFile(local, 'second');
    const b = await uploadToRemote(remote, root, local, root);
    expect(a.path).toBe(join(root, '.zcc-uploads', 'dup.txt'));
    expect(b.path).toBe(join(root, '.zcc-uploads', 'dup (1).txt'));
    // The original is untouched; the second got its own name.
    expect(await readFile(a.path!, 'utf8')).toBe('first');
    expect(await readFile(b.path!, 'utf8')).toBe('second');
  });

  it('preserves the extension when suffixing (suffix before the dot)', async () => {
    const local = join(localDir, 'archive.tar.gz');
    await writeFile(local, 'x');
    await uploadToRemote(remote, root, local, root);
    const second = await uploadToRemote(remote, root, local, root);
    expect(second.path).toBe(join(root, '.zcc-uploads', 'archive.tar (1).gz'));
  });

  it('refuses to upload a directory', async () => {
    const d = join(localDir, 'adir');
    await mkdir(d);
    const res = await uploadToRemote(remote, root, d, root);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/regular files/);
  });

  it('rejects an upload destination outside the project root', async () => {
    const local = join(localDir, 'x.txt');
    await writeFile(local, 'x');
    const res = await uploadToRemote(remote, root, local, '/etc');
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/outside the project/);
  });

  it('downloads a remote file to a local path', async () => {
    const src = join(root, 'data.txt');
    await writeFile(src, 'pull me down');
    const dest = join(localDir, 'saved.txt');
    const res = await downloadFromRemote(remote, root, src, dest);
    expect(res.ok).toBe(true);
    expect(res.bytes).toBe(12);
    expect(res.path).toBe(dest);
    expect(await readFile(dest, 'utf8')).toBe('pull me down');
  });

  it('downloads binary content byte-for-byte', async () => {
    const src = join(root, 'blob.bin');
    const bytes = Buffer.from([0x00, 0x01, 0xfe, 0xff, 0x00]);
    await writeFile(src, bytes);
    const dest = join(localDir, 'out.bin');
    const res = await downloadFromRemote(remote, root, src, dest);
    expect(res.ok).toBe(true);
    expect(Buffer.from(await readFile(dest))).toEqual(bytes);
  });

  it('creates missing local parent dirs on download', async () => {
    const src = join(root, 'deep.txt');
    await writeFile(src, 'ok');
    const dest = join(localDir, 'a', 'b', 'c', 'deep.txt');
    const res = await downloadFromRemote(remote, root, src, dest);
    expect(res.ok).toBe(true);
    expect(await readFile(dest, 'utf8')).toBe('ok');
  });

  it('refuses to download a directory', async () => {
    const d = join(root, 'subdir');
    await mkdir(d);
    const res = await downloadFromRemote(remote, root, d, join(localDir, 'x'));
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Not a regular file');
  });

  it('rejects a download source outside the project root', async () => {
    const res = await downloadFromRemote(remote, root, '/etc/hosts', join(localDir, 'h'));
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/outside the project/);
  });
});
