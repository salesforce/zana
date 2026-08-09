import { describe, it, expect, vi } from 'vitest';
import { registerMicrovmExecTool, type RegisterMicrovmExecOpts } from '../microvm-exec-mcp-tool.js';
import type { MicroVmExecResult } from '../microvm/pool.js';

/**
 * Minimal fake McpServer that captures the registered handlers so we can invoke
 * them directly without an HTTP transport. Mirrors remote-exec-mcp-tool.test.ts.
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

function register(
  run: RegisterMicrovmExecOpts['runMicrovmCommand'],
  reset?: RegisterMicrovmExecOpts['resetMicrovm']
) {
  const { server, tools } = fakeServer();
  registerMicrovmExecTool(server as never, { runMicrovmCommand: run, resetMicrovm: reset });
  return tools;
}

describe('registerMicrovmExecTool', () => {
  it('registers only microvm_exec when no reset runner is wired', () => {
    const tools = register(async () => ({ ok: true, code: 0 }));
    expect([...tools.keys()]).toEqual(['microvm_exec']);
  });

  it('registers microvm_reset too when the reset runner is wired', () => {
    const tools = register(
      async () => ({ ok: true, code: 0 }),
      async () => ({ ok: true, existed: true })
    );
    expect([...tools.keys()].sort()).toEqual(['microvm_exec', 'microvm_reset']);
  });

  it('passes projectId + command + opts to the injected runner and projects the result', async () => {
    const run = vi.fn(
      async (): Promise<MicroVmExecResult> => ({ ok: true, code: 0, stdout: 'hi\n', stderr: '', truncated: false })
    );
    const res = await register(run).get('microvm_exec')!({
      projectId: 'p1',
      command: 'echo hi',
      network: 'none',
      timeoutMs: 5000
    });
    expect(run).toHaveBeenCalledWith('p1', 'echo hi', { network: 'none', timeoutMs: 5000 });
    const out = payload(res);
    expect(out).toEqual({ projectId: 'p1', exitCode: 0, stdout: 'hi\n', stderr: '', truncated: false });
    expect(res.isError).toBeUndefined();
  });

  it('omits network/timeoutMs from the runner call when not supplied', async () => {
    const run = vi.fn(async (): Promise<MicroVmExecResult> => ({ ok: true, code: 0, stdout: '', stderr: '' }));
    await register(run).get('microvm_exec')!({ projectId: 'p1', command: 'ls' });
    expect(run).toHaveBeenCalledWith('p1', 'ls', {});
  });

  it('surfaces a non-zero exit as DATA, not an error', async () => {
    const run = async (): Promise<MicroVmExecResult> => ({ ok: true, code: 2, stdout: '', stderr: 'boom' });
    const res = await register(run).get('microvm_exec')!({ projectId: 'p1', command: 'false' });
    expect(res.isError).toBeUndefined();
    const out = payload(res);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toBe('boom');
  });

  it('returns isError when the runner reports unavailability (disabled / unsupported / boot failure)', async () => {
    const run = async (): Promise<MicroVmExecResult> => ({
      ok: false,
      message: 'microVM playground unavailable: microVM playground is disabled (enable it in Settings)'
    });
    const res = await register(run).get('microvm_exec')!({ projectId: 'p1', command: 'ls' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('disabled');
  });

  it('returns isError when the runner throws', async () => {
    const run = async (): Promise<MicroVmExecResult> => {
      throw new Error('pool exploded');
    };
    const res = await register(run).get('microvm_exec')!({ projectId: 'p1', command: 'ls' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('pool exploded');
  });

  it('reports truncated:true when the runner clipped output', async () => {
    const run = async (): Promise<MicroVmExecResult> => ({ ok: true, code: 0, stdout: 'x', stderr: '', truncated: true });
    const out = payload(await register(run).get('microvm_exec')!({ projectId: 'p1', command: 'cat big' }));
    expect(out.truncated).toBe(true);
  });

  it('projects a null exit code (command could not run) as null', async () => {
    const run = async (): Promise<MicroVmExecResult> => ({ ok: true, code: null, stdout: '', stderr: '' });
    const out = payload(await register(run).get('microvm_exec')!({ projectId: 'p1', command: 'true' }));
    expect(out.exitCode).toBeNull();
  });

  describe('microvm_reset', () => {
    it('forwards to the reset runner and reports whether a guest existed', async () => {
      const reset = vi.fn(async () => ({ ok: true as const, existed: true }));
      const tools = register(async () => ({ ok: true, code: 0 }), reset);
      const out = payload(await tools.get('microvm_reset')!({ projectId: 'p1' }));
      expect(reset).toHaveBeenCalledWith('p1');
      expect(out).toEqual({ projectId: 'p1', existed: true });
    });

    it('returns isError when the reset runner throws', async () => {
      const reset = async () => {
        throw new Error('reset exploded');
      };
      const tools = register(async () => ({ ok: true, code: 0 }), reset);
      const res = await tools.get('microvm_reset')!({ projectId: 'p1' });
      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toContain('reset exploded');
    });
  });
});
