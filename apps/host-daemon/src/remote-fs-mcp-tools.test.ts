import { describe, it, expect, vi } from 'vitest';
import { registerRemoteFsTools, type RegisterRemoteFsToolsOpts } from './remote-fs-mcp-tools.js';
import type { FsReadResult, FsWriteResult } from '@zana-ai/zcc-domain/product';

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
}>;

function fakeServer() {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _def: unknown, handler: ToolHandler) => {
      tools.set(name, handler);
    }
  };
  return { server, tools };
}

function payload(res: { content: Array<{ type: string; text?: string }> }) {
  return res.content.find((c) => c.type === 'text')?.text ?? '';
}

function register(over: Partial<RegisterRemoteFsToolsOpts> = {}) {
  const { server, tools } = fakeServer();
  const opts: RegisterRemoteFsToolsOpts = {
    projectId: 'p-ssh',
    readFile: async () => ({ ok: true, content: 'hello', bytes: 5, binary: false }),
    writeFile: async () => ({ ok: true, bytes: 5 }),
    listDir: async () => ({ ok: true, entries: [] }),
    glob: async () => ({ ok: true, files: ['src/a.ts'] }),
    grep: async () => ({ ok: true, output: 'src/a.ts:1:hi', truncated: false }),
    ...over
  };
  registerRemoteFsTools(server as never, opts);
  return { tools, opts };
}

describe('registerRemoteFsTools', () => {
  it('registers route-scoped file tools and keeps remote_exec out of this pack', () => {
    const { tools } = register();
    expect([...tools.keys()]).toEqual([
      'remote_read',
      'remote_write',
      'remote_edit',
      'remote_glob',
      'remote_grep'
    ]);
  });

  it('closes over the URL projectId so the agent cannot pick a host', async () => {
    const readFile = vi.fn(async (): Promise<FsReadResult> => ({
      ok: true, content: 'ok', bytes: 2, binary: false
    }));
    const { tools } = register({ readFile });
    await tools.get('remote_read')!({ path: 'README.md', projectId: 'other' });
    expect(readFile).toHaveBeenCalledWith('p-ssh', 'README.md');
  });

  it('surfaces a non-remote / unknown project as isError', async () => {
    const { tools } = register({
      readFile: async () => ({ ok: false, message: 'Not a remote project' })
    });
    const res = await tools.get('remote_read')!({ path: 'README.md' });
    expect(res.isError).toBe(true);
    expect(payload(res)).toContain('Not a remote project');
  });

  it('writes using the closed-over project id', async () => {
    const writeFile = vi.fn(async (): Promise<FsWriteResult> => ({ ok: true, bytes: 3 }));
    const { tools } = register({ writeFile });
    const res = await tools.get('remote_write')!({ path: 'a.ts', content: 'abc' });
    expect(writeFile).toHaveBeenCalledWith('p-ssh', 'a.ts', 'abc');
    expect(res.isError).toBeUndefined();
  });

  it('edits a unique substring and rejects a missing or duplicate match', async () => {
    const writeFile = vi.fn(async (): Promise<FsWriteResult> => ({ ok: true, bytes: 5 }));
    const { tools } = register({
      readFile: async () => ({ ok: true, content: 'alpha beta', bytes: 10, binary: false }),
      writeFile
    });
    const ok = await tools.get('remote_edit')!({
      path: 'a.txt',
      old_string: 'beta',
      new_string: 'gamma'
    });
    expect(writeFile).toHaveBeenCalledWith('p-ssh', 'a.txt', 'alpha gamma');
    expect(ok.isError).toBeUndefined();

    const missing = await register({
      readFile: async () => ({ ok: true, content: 'alpha', bytes: 5, binary: false })
    }).tools.get('remote_edit')!({ path: 'a.txt', old_string: 'beta', new_string: 'x' });
    expect(missing.isError).toBe(true);
    expect(payload(missing)).toContain('old_string not found');

    const dup = await register({
      readFile: async () => ({ ok: true, content: 'x x', bytes: 3, binary: false })
    }).tools.get('remote_edit')!({ path: 'a.txt', old_string: 'x', new_string: 'y' });
    expect(dup.isError).toBe(true);
    expect(payload(dup)).toContain('not unique');
  });

  it('globs and greps through the injected runners', async () => {
    const glob = vi.fn(async () => ({ ok: true as const, files: ['src/a.ts'] }));
    const grep = vi.fn(async () => ({ ok: true as const, output: 'hit', truncated: false }));
    const { tools } = register({ glob, grep });
    await tools.get('remote_glob')!({ pattern: '*.ts', path: 'src' });
    await tools.get('remote_grep')!({ pattern: 'hit', path: 'src' });
    expect(glob).toHaveBeenCalledWith('p-ssh', '*.ts', 'src');
    expect(grep).toHaveBeenCalledWith('p-ssh', 'hit', 'src');
  });
});
