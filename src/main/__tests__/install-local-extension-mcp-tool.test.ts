import { describe, it, expect, vi } from 'vitest';
import {
  registerInstallLocalExtensionTool,
  type RegisterInstallLocalExtensionOpts
} from '../install-local-extension-mcp-tool.js';

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

function text(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.find((c) => c.type === 'text')?.text ?? '';
}

function makeOpts(
  over: Partial<RegisterInstallLocalExtensionOpts> = {}
): RegisterInstallLocalExtensionOpts {
  return {
    sessionId: 'sess-1',
    installOwnExtension: vi.fn(async () => ({ ok: true as const, value: { id: 'my-ext-a1b2' } })),
    ...over
  };
}

describe('registerInstallLocalExtensionTool', () => {
  it('registers the tool', () => {
    const { server, tools } = fakeServer();
    registerInstallLocalExtensionTool(server as never, makeOpts());
    expect([...tools.keys()]).toEqual(['install_local_extension']);
  });

  it('installs the session-owned extension and reports its id', async () => {
    const installOwnExtension = vi.fn(async () => ({ ok: true as const, value: { id: 'my-ext-a1b2' } }));
    const { server, tools } = fakeServer();
    registerInstallLocalExtensionTool(server as never, makeOpts({ installOwnExtension }));

    const res = await tools.get('install_local_extension')!({});
    expect(res.isError).toBeFalsy();
    expect(installOwnExtension).toHaveBeenCalledWith('sess-1');
    expect(text(res)).toContain('my-ext-a1b2');
  });

  it('surfaces a typed failure (e.g. NOT_LOCAL) as isError, without throwing', async () => {
    const installOwnExtension = vi.fn(async () => ({
      ok: false as const,
      code: 'NOT_LOCAL',
      message: 'This working directory is not a registered local extension'
    }));
    const { server, tools } = fakeServer();
    registerInstallLocalExtensionTool(server as never, makeOpts({ installOwnExtension }));

    const res = await tools.get('install_local_extension')!({});
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('not a registered local extension');
  });

  it('errors (and never calls installOwnExtension) when there is no originating session', async () => {
    const installOwnExtension = vi.fn(async () => ({ ok: true as const, value: { id: 'x' } }));
    const { server, tools } = fakeServer();
    registerInstallLocalExtensionTool(
      server as never,
      makeOpts({ sessionId: undefined, installOwnExtension })
    );

    const res = await tools.get('install_local_extension')!({});
    expect(res.isError).toBe(true);
    expect(installOwnExtension).not.toHaveBeenCalled();
  });
});
