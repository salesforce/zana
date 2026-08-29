import { describe, expect, it, vi } from 'vitest';
import { AmbiguousHostError, HostUnavailableError } from './host-hub.js';
import {
  listHostFiles,
  listHostPaths,
  mkdirHostPath,
  moveHostPath,
  readHostFile,
  removeHostPath,
  writeHostFile
} from './files-via-host.js';
import type { ProductHttpContext } from './product-context.js';

function ctx(callHostOnlineRpc: (input: unknown) => Promise<unknown>, resolveHostId?: (hostId?: string) => string) {
  return {
    hostHub: {
      resolveHostId: resolveHostId ?? ((hostId?: string) => hostId ?? 'host-1'),
      callHostOnlineRpc
    }
  } as unknown as ProductHttpContext;
}

describe('files-via-host', () => {
  it('writes with Host-RPC defaults for encoding and createParents', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({
      outcome: 'written',
      sha256: 'a'.repeat(64),
      sizeBytes: 5
    }));
    await expect(writeHostFile(ctx(callHostOnlineRpc), {
      path: '/tmp/note.md',
      content: 'hello'
    })).resolves.toEqual({
      outcome: 'written',
      sha256: 'a'.repeat(64),
      sizeBytes: 5
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: {
        type: 'host.write_file',
        path: '/tmp/note.md',
        content: 'hello',
        contentEncoding: 'utf8',
        createParents: false
      }
    });
  });

  it('passes compare-and-swap fields and returns a conflict payload', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({
      outcome: 'conflict',
      currentSha256: 'b'.repeat(64)
    }));
    await expect(writeHostFile(ctx(callHostOnlineRpc), {
      hostId: 'host-2',
      path: '/tmp/note.md',
      rootPath: '/tmp',
      content: 'next',
      contentEncoding: 'base64',
      createParents: true,
      expectedSha256: 'a'.repeat(64),
      mode: 0o644
    })).resolves.toEqual({
      outcome: 'conflict',
      currentSha256: 'b'.repeat(64)
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-2',
      command: {
        type: 'host.write_file',
        path: '/tmp/note.md',
        rootPath: '/tmp',
        content: 'next',
        contentEncoding: 'base64',
        createParents: true,
        expectedSha256: 'a'.repeat(64),
        mode: 0o644
      }
    });
  });

  it('mkdirs, moves, and removes with recursive defaulting to false', async () => {
    const commands: unknown[] = [];
    const callHostOnlineRpc = vi.fn(async (input: { command: unknown }) => {
      commands.push(input.command);
      return { ok: true };
    });
    const product = ctx(callHostOnlineRpc);
    await expect(mkdirHostPath(product, { path: '/tmp/dir' })).resolves.toEqual({ ok: true });
    await expect(moveHostPath(product, {
      sourcePath: '/tmp/a.md',
      destinationPath: '/tmp/b.md'
    })).resolves.toEqual({ ok: true });
    await expect(removeHostPath(product, { path: '/tmp/b.md' })).resolves.toEqual({ ok: true });
    expect(commands).toEqual([
      { type: 'host.mkdir', path: '/tmp/dir', recursive: false },
      {
        type: 'host.move_path',
        sourcePath: '/tmp/a.md',
        destinationPath: '/tmp/b.md'
      },
      { type: 'host.remove_path', path: '/tmp/b.md', recursive: false }
    ]);
  });

  it('maps an unavailable host to 503', async () => {
    await expect(writeHostFile(ctx(async () => {
      throw new HostUnavailableError();
    }), { path: '/tmp/a.md', content: 'x' })).rejects.toMatchObject({
      status: 503,
      code: 'host-unavailable'
    });
  });

  it('maps an ambiguous host to 409 before RPC', async () => {
    const callHostOnlineRpc = vi.fn();
    await expect(writeHostFile(ctx(callHostOnlineRpc, () => {
      throw new AmbiguousHostError();
    }), { path: '/tmp/a.md', content: 'x' })).rejects.toMatchObject({
      status: 409,
      code: 'ambiguous-host'
    });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('maps invalid_path from the daemon to 400', async () => {
    await expect(mkdirHostPath(ctx(async () => {
      throw Object.assign(new Error('path must be absolute'), { code: 'invalid_path' });
    }), { path: 'relative' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_path'
    });
  });

  it('maps path_not_found to 404 and other daemon codes to 500', async () => {
    await expect(moveHostPath(ctx(async () => {
      throw Object.assign(new Error('missing'), { code: 'path_not_found' });
    }), { sourcePath: '/tmp/a', destinationPath: '/tmp/b' })).rejects.toMatchObject({
      status: 404,
      code: 'path_not_found'
    });
    await expect(removeHostPath(ctx(async () => {
      throw Object.assign(new Error('boom'), { code: 'io_error' });
    }), { path: '/tmp/a' })).rejects.toMatchObject({
      status: 500,
      code: 'io_error'
    });
  });

  it('rethrows unexpected errors', async () => {
    await expect(writeHostFile(ctx(async () => {
      throw new Error('socket exploded');
    }), { path: '/tmp/a.md', content: 'x' })).rejects.toThrow('socket exploded');
  });

  it('reads an absolute path through host.read_path', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({
      path: '/tmp/note.md',
      content: 'hello',
      contentEncoding: 'utf8',
      sizeBytes: 5,
      sha256: 'a'.repeat(64)
    }));
    await expect(readHostFile(ctx(callHostOnlineRpc), {
      path: '/tmp/note.md',
      rootPath: '/tmp'
    })).resolves.toMatchObject({ content: 'hello', contentEncoding: 'utf8' });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: { type: 'host.read_path', path: '/tmp/note.md', rootPath: '/tmp' }
    });
  });

  it('lists files by mapping host.list_paths to the files-only result', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({
      paths: [{
        kind: 'file',
        path: 'src/foo.ts',
        name: 'foo.ts',
        score: 12,
        positions: [4, 5, 6]
      }],
      truncated: false
    }));
    await expect(listHostFiles(ctx(callHostOnlineRpc), { path: '/tmp/proj' })).resolves.toEqual({
      files: [{ path: 'src/foo.ts', name: 'foo.ts' }],
      truncated: false
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: {
        type: 'host.list_paths',
        path: '/tmp/proj',
        limit: 80,
        includeFiles: true,
        includeDirectories: false
      }
    });
  });

  it('lists paths and rejects an empty kind set', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ paths: [], truncated: false }));
    await expect(listHostPaths(ctx(callHostOnlineRpc), {
      path: '/tmp/proj',
      query: 'foo',
      limit: 10,
      includeFiles: true,
      includeDirectories: true
    })).resolves.toEqual({ paths: [], truncated: false });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: 'host-1',
      command: {
        type: 'host.list_paths',
        path: '/tmp/proj',
        query: 'foo',
        limit: 10,
        includeFiles: true,
        includeDirectories: true
      }
    });
    await expect(listHostPaths(ctx(callHostOnlineRpc), {
      path: '/tmp/proj',
      includeFiles: false,
      includeDirectories: false
    })).rejects.toMatchObject({ status: 400, code: 'invalid-input' });
  });

  it('maps daemon errors on read and list_paths', async () => {
    await expect(readHostFile(ctx(async () => {
      throw Object.assign(new Error('path must be absolute'), { code: 'invalid_path' });
    }), { path: 'relative' })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_path'
    });
    await expect(listHostPaths(ctx(async () => {
      throw Object.assign(new Error('missing'), { code: 'path_not_found' });
    }), { path: '/tmp/missing', includeFiles: true, includeDirectories: false })).rejects.toMatchObject({
      status: 404,
      code: 'path_not_found'
    });
  });
});
