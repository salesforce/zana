import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { HostCommandError } from './host-command-error.js';
import {
  browseHostDirectory,
  checkHostPathsExist,
  HOST_WRITE_MAX_BYTES,
  listHostPaths,
  mkdirHostPath,
  moveHostPath,
  pickHostFolder,
  rankListedPath,
  readHostFileMetadata,
  readHostPath,
  removeHostPath,
  writeHostFile
} from './host-fs.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-host-fs-'));
  dirs.push(dir);
  return dir;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

describe('host filesystem mutations', () => {
  it('writes a new file under a confined root', async () => {
    const root = tmpRoot();
    const path = join(root, 'note.txt');
    const result = await writeHostFile({
      path,
      rootPath: root,
      content: 'hello',
      contentEncoding: 'utf8',
      createParents: false
    });
    expect(result).toEqual({
      outcome: 'written',
      sha256: sha256('hello'),
      sizeBytes: 5
    });
    expect(readFileSync(path, 'utf8')).toBe('hello');
  });

  it('rejects a relative write path and a write that exceeds the size cap', async () => {
    await expect(writeHostFile({
      path: 'relative.txt',
      content: 'x',
      contentEncoding: 'utf8',
      createParents: false
    })).rejects.toMatchObject({ code: 'invalid_path' });
    const root = tmpRoot();
    await expect(writeHostFile({
      path: join(root, 'big.bin'),
      rootPath: root,
      content: 'a'.repeat(HOST_WRITE_MAX_BYTES + 1),
      contentEncoding: 'utf8',
      createParents: false
    })).rejects.toMatchObject({ code: 'too_large' });
  });

  it('rejects writing a directory and missing parents without createParents', async () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'dir'));
    await expect(writeHostFile({
      path: join(root, 'dir'),
      rootPath: root,
      content: 'x',
      contentEncoding: 'utf8',
      createParents: false
    })).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(writeHostFile({
      path: join(root, 'missing', 'a.txt'),
      rootPath: root,
      content: 'x',
      contentEncoding: 'utf8',
      createParents: false
    })).rejects.toMatchObject({ code: 'path_not_found' });
  });

  it('creates a file when expectedSha256 is null and the path is free', async () => {
    const root = tmpRoot();
    const path = join(root, 'fresh.txt');
    const result = await writeHostFile({
      path,
      rootPath: root,
      content: 'fresh',
      contentEncoding: 'utf8',
      createParents: false,
      expectedSha256: null
    });
    expect(result.outcome).toBe('written');
    expect(readFileSync(path, 'utf8')).toBe('fresh');
  });

  it('mkdir recursive, remove recursive, and browse a symlink directory', async () => {
    const root = tmpRoot();
    await mkdirHostPath({ path: join(root, 'nested', 'dir'), rootPath: root, recursive: true });
    writeFileSync(join(root, 'nested', 'dir', 'a.txt'), 'a');
    const link = join(root, 'link-dir');
    symlinkSync(join(root, 'nested'), link);
    const listed = await browseHostDirectory({ path: link });
    expect(listed.entries.some((entry) => entry.name === 'dir' && entry.kind === 'directory')).toBe(true);
    await removeHostPath({ path: join(root, 'nested'), rootPath: root, recursive: true });
    expect((await checkHostPathsExist({ paths: [join(root, 'nested')] })).existence[join(root, 'nested')]).toBe(false);
  });

  it('rejects browsing a file', async () => {
    const root = tmpRoot();
    const file = join(root, 'note.txt');
    writeFileSync(file, 'x');
    await expect(browseHostDirectory({ path: file })).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('rejects a write that escapes the root via a symlink', async () => {
    const root = tmpRoot();
    const outside = tmpRoot();
    symlinkSync(outside, join(root, 'escape'));
    await expect(writeHostFile({
      path: join(root, 'escape', 'secret.txt'),
      rootPath: root,
      content: 'nope',
      contentEncoding: 'utf8',
      createParents: false
    })).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('returns conflict when expectedSha256 does not match', async () => {
    const root = tmpRoot();
    const path = join(root, 'note.txt');
    writeFileSync(path, 'old');
    const result = await writeHostFile({
      path,
      rootPath: root,
      content: 'new',
      contentEncoding: 'utf8',
      createParents: false,
      expectedSha256: sha256('stale')
    });
    expect(result).toEqual({ outcome: 'conflict', currentSha256: sha256('old') });
    expect(readFileSync(path, 'utf8')).toBe('old');
  });

  it('compare-and-swap writes when the hash matches', async () => {
    const root = tmpRoot();
    const path = join(root, 'note.txt');
    writeFileSync(path, 'old');
    const result = await writeHostFile({
      path,
      rootPath: root,
      content: 'new',
      contentEncoding: 'utf8',
      createParents: false,
      expectedSha256: sha256('old')
    });
    expect(result.outcome).toBe('written');
    expect(readFileSync(path, 'utf8')).toBe('new');
  });

  it('create-only write conflicts when the file already exists', async () => {
    const root = tmpRoot();
    const path = join(root, 'note.txt');
    writeFileSync(path, 'old');
    const result = await writeHostFile({
      path,
      rootPath: root,
      content: 'new',
      contentEncoding: 'utf8',
      createParents: false,
      expectedSha256: null
    });
    expect(result).toEqual({ outcome: 'conflict', currentSha256: sha256('old') });
  });

  it('creates parent directories when asked', async () => {
    const root = tmpRoot();
    const path = join(root, 'nested', 'a', 'note.txt');
    await writeHostFile({
      path,
      rootPath: root,
      content: 'ok',
      contentEncoding: 'utf8',
      createParents: true
    });
    expect(readFileSync(path, 'utf8')).toBe('ok');
  });

  it('mkdir, move, and remove stay inside the root', async () => {
    const root = tmpRoot();
    await mkdirHostPath({ path: join(root, 'dir'), rootPath: root, recursive: false });
    writeFileSync(join(root, 'dir', 'a.txt'), 'a');
    await moveHostPath({
      sourcePath: join(root, 'dir', 'a.txt'),
      destinationPath: join(root, 'b.txt'),
      rootPath: root
    });
    expect(readFileSync(join(root, 'b.txt'), 'utf8')).toBe('a');
    await removeHostPath({ path: join(root, 'b.txt'), rootPath: root, recursive: false });
    expect(await checkHostPathsExist({ paths: [join(root, 'b.txt')] })).toEqual({
      existence: { [join(root, 'b.txt')]: false }
    });
  });

  it('refuses to remove the declared root', async () => {
    const root = tmpRoot();
    await expect(removeHostPath({
      path: root,
      rootPath: root,
      recursive: true
    })).rejects.toBeInstanceOf(HostCommandError);
  });

  it('refuses to move onto an existing destination', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'a.txt'), 'a');
    writeFileSync(join(root, 'b.txt'), 'b');
    await expect(moveHostPath({
      sourcePath: join(root, 'a.txt'),
      destinationPath: join(root, 'b.txt'),
      rootPath: root
    })).rejects.toMatchObject({ code: 'path_exists' });
  });

  it('browses a directory and skips node_modules and dotfiles', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'note.md'), '# hi');
    mkdirSync(join(root, 'apps'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, '.hidden'), 'secret');
    const listed = await browseHostDirectory({ path: root });
    expect(listed.directory).toBe(realpathSync(root));
    expect(listed.entries.map((entry) => entry.name).sort()).toEqual(['apps', 'note.md']);
    expect(listed.entries.find((entry) => entry.name === 'apps')?.kind).toBe('directory');
  });

  it('rejects a relative browse path', async () => {
    await expect(browseHostDirectory({ path: 'relative' })).rejects.toMatchObject({
      code: 'invalid_path'
    });
  });

  it('reports path existence', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'yes.txt'), 'y');
    const missing = join(root, 'no.txt');
    const result = await checkHostPathsExist({ paths: [join(root, 'yes.txt'), missing, join(root, 'yes.txt')] });
    expect(result.existence[join(root, 'yes.txt')]).toBe(true);
    expect(result.existence[missing]).toBe(false);
  });
});

describe('host filesystem discovery', () => {
  it('lists files and directories, skips dots/node_modules/symlinks, and ranks a query', async () => {
    const root = tmpRoot();
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'foo.ts'), 'export {}\n');
    writeFileSync(join(root, 'README.md'), '# hi\n');
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules', 'pkg.js'), 'nope');
    writeFileSync(join(root, '.hidden'), 'secret');
    mkdirSync(join(root, 'linked-src'));
    symlinkSync(join(root, 'src', 'foo.ts'), join(root, 'linked-src', 'foo.ts'));
    const listed = await listHostPaths({
      path: root,
      query: 'foo',
      limit: 20,
      includeFiles: true,
      includeDirectories: true
    });
    expect(listed.truncated).toBe(false);
    expect(listed.paths.map((entry) => entry.path)).toEqual(['src/foo.ts']);
    expect(listed.paths[0]?.positions.length).toBeGreaterThan(0);
    const filesOnly = await listHostPaths({
      path: root,
      limit: 20,
      includeFiles: true,
      includeDirectories: false
    });
    expect(filesOnly.paths.every((entry) => entry.kind === 'file')).toBe(true);
    expect(filesOnly.paths.some((entry) => entry.path.includes('node_modules'))).toBe(false);
  });

  it('truncates when the limit is smaller than the match set', async () => {
    const root = tmpRoot();
    writeFileSync(join(root, 'a.ts'), 'a');
    writeFileSync(join(root, 'b.ts'), 'b');
    writeFileSync(join(root, 'c.ts'), 'c');
    const listed = await listHostPaths({
      path: root,
      limit: 1,
      includeFiles: true,
      includeDirectories: false
    });
    expect(listed.paths).toHaveLength(1);
    expect(listed.truncated).toBe(true);
  });

  it('rejects a relative list root, a file root, and a symlink root', async () => {
    await expect(listHostPaths({
      path: 'relative',
      limit: 10,
      includeFiles: true,
      includeDirectories: false
    })).rejects.toMatchObject({ code: 'invalid_path' });
    const root = tmpRoot();
    const file = join(root, 'note.txt');
    writeFileSync(file, 'x');
    await expect(listHostPaths({
      path: file,
      limit: 10,
      includeFiles: true,
      includeDirectories: false
    })).rejects.toMatchObject({ code: 'invalid_path' });
    const linked = join(root, 'link-dir');
    symlinkSync(root, linked);
    await expect(listHostPaths({
      path: linked,
      limit: 10,
      includeFiles: true,
      includeDirectories: false
    })).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('reads utf8 and base64 content with a sha256, and refuses a directory', async () => {
    const root = tmpRoot();
    const textPath = join(root, 'note.txt');
    writeFileSync(textPath, 'hello');
    const text = await readHostPath({ path: textPath, rootPath: root });
    expect(text).toMatchObject({
      path: textPath,
      content: 'hello',
      contentEncoding: 'utf8',
      sizeBytes: 5,
      sha256: sha256('hello')
    });
    const binaryPath = join(root, 'blob.bin');
    writeFileSync(binaryPath, Buffer.from([0xff, 0xfe, 0x00, 0x01]));
    const binary = await readHostPath({ path: binaryPath, rootPath: root });
    expect(binary.contentEncoding).toBe('base64');
    expect(binary.content).toBe(Buffer.from([0xff, 0xfe, 0x00, 0x01]).toString('base64'));
    const meta = await readHostFileMetadata({ path: textPath, rootPath: root });
    expect(meta.sizeBytes).toBe(5);
    expect(meta.modifiedAtMs).toBeGreaterThan(0);
    await expect(readHostPath({ path: textPath })).resolves.toMatchObject({ content: 'hello' });
    await expect(readHostPath({ path: root, rootPath: root })).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(readHostPath({
      path: join(root, 'missing.txt'),
      rootPath: root
    })).rejects.toMatchObject({ code: 'path_not_found' });
  });

  it('rejects a read that escapes the root via a symlink', async () => {
    const root = tmpRoot();
    const outside = tmpRoot();
    writeFileSync(join(outside, 'secret.txt'), 'nope');
    symlinkSync(outside, join(root, 'escape'));
    await expect(readHostPath({
      path: join(root, 'escape', 'secret.txt'),
      rootPath: root
    })).rejects.toMatchObject({ code: 'invalid_path' });
    await expect(readHostFileMetadata({
      path: join(root, 'escape', 'secret.txt'),
      rootPath: root
    })).rejects.toMatchObject({ code: 'invalid_path' });
  });

  it('ranks a substring ahead of a sequential character match', () => {
    expect(rankListedPath('src/foo.ts', '')).toEqual({ score: 0, positions: [] });
    expect(rankListedPath('src/foo.ts', 'foo')?.positions).toEqual([4, 5, 6]);
    expect(rankListedPath('src/foo.ts', 'xyz')).toBeNull();
    expect(rankListedPath('src/foo.ts', 'sft')?.positions).toEqual([0, 4, 8]);
  });

  it('returns null when the macOS picker is cancelled and rejects other platforms', async () => {
    await expect(pickHostFolder({
      platform: 'darwin',
      execFile: async () => ({ stdout: '\n' })
    })).resolves.toEqual({ path: null });
    await expect(pickHostFolder({
      platform: 'darwin',
      execFile: async () => ({ stdout: '/Users/me/proj/\n' })
    })).resolves.toEqual({ path: '/Users/me/proj' });
    await expect(pickHostFolder({ platform: 'linux' })).rejects.toMatchObject({
      code: 'unsupported_platform'
    });
    await expect(pickHostFolder({
      platform: 'darwin',
      execFile: async () => {
        throw new Error('osascript exploded');
      }
    })).rejects.toMatchObject({ code: 'folder_picker_failed' });
  });
});
