import { describe, it, expect, vi } from 'vitest';
import { registerRemoteExecTool, type RegisterRemoteExecOpts } from '../remote-exec-mcp-tool.js';
import type { RemoteExecResult } from '../../shared/types.js';

/**
 * Minimal fake McpServer that captures the registered handler so we can invoke
 * it directly without an HTTP transport. Mirrors inbox-search-mcp-tool.test.ts.
 */
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
  return JSON.parse(res.content.find((c) => c.type === 'text')?.text ?? '{}');
}

function register(run: RegisterRemoteExecOpts['runRemoteCommand']) {
  const { server, tools } = fakeServer();
  registerRemoteExecTool(server as never, { runRemoteCommand: run });
  return tools.get('remote_exec')!;
}

describe('registerRemoteExecTool', () => {
  it('registers a remote_exec tool', () => {
    const { server, tools } = fakeServer();
    registerRemoteExecTool(server as never, { runRemoteCommand: async () => ({ ok: true, code: 0 }) });
    expect([...tools.keys()]).toEqual(['remote_exec']);
  });

  it('passes projectId + command + opts to the injected runner and projects the result', async () => {
    const run = vi.fn(
      async (): Promise<RemoteExecResult> => ({ ok: true, code: 0, stdout: 'hi\n', stderr: '', truncated: false })
    );
    const res = await register(run)({ projectId: 'p1', command: 'echo hi', cwd: 'src', timeoutMs: 5000 });
    expect(run).toHaveBeenCalledWith('p1', 'echo hi', { cwd: 'src', timeoutMs: 5000 });
    const out = payload(res);
    expect(out).toEqual({ projectId: 'p1', exitCode: 0, stdout: 'hi\n', stderr: '', truncated: false });
    expect(res.isError).toBeUndefined();
  });

  it('omits cwd/timeoutMs from the runner call when not supplied', async () => {
    const run = vi.fn(async (): Promise<RemoteExecResult> => ({ ok: true, code: 0, stdout: '', stderr: '' }));
    await register(run)({ projectId: 'p1', command: 'ls' });
    expect(run).toHaveBeenCalledWith('p1', 'ls', {});
  });

  it('surfaces a non-zero exit as DATA, not an error', async () => {
    const run = async (): Promise<RemoteExecResult> => ({ ok: true, code: 2, stdout: '', stderr: 'boom' });
    const res = await register(run)({ projectId: 'p1', command: 'false' });
    expect(res.isError).toBeUndefined();
    const out = payload(res);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toBe('boom');
  });

  it('returns isError when the runner reports a transport failure (e.g. not a remote project)', async () => {
    const run = async (): Promise<RemoteExecResult> => ({ ok: false, message: 'Not a remote project' });
    const res = await register(run)({ projectId: 'local1', command: 'ls' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('Not a remote project');
  });

  it('returns isError when the runner throws', async () => {
    const run = async (): Promise<RemoteExecResult> => {
      throw new Error('ssh exploded');
    };
    const res = await register(run)({ projectId: 'p1', command: 'ls' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('ssh exploded');
  });

  it('reports truncated:true when the runner clipped output', async () => {
    const run = async (): Promise<RemoteExecResult> => ({ ok: true, code: 0, stdout: 'x', stderr: '', truncated: true });
    const out = payload(await register(run)({ projectId: 'p1', command: 'cat big' }));
    expect(out.truncated).toBe(true);
  });
});
