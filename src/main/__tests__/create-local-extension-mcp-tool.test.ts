import { describe, it, expect, vi } from 'vitest';
import {
  registerCreateLocalExtensionTool,
  type RegisterCreateLocalExtensionOpts
} from '../create-local-extension-mcp-tool.js';

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
  over: Partial<RegisterCreateLocalExtensionOpts> = {}
): RegisterCreateLocalExtensionOpts {
  return {
    createLocalExtension: vi.fn(async () => ({
      ok: true as const,
      value: { id: 'my-ext-a1b2', workingDir: '/home/u/zcc-workspace/extensions/my-ext-a1b2', projectId: 'proj-1' }
    })),
    ...over
  };
}

describe('registerCreateLocalExtensionTool', () => {
  it('registers the tool', () => {
    const { server, tools } = fakeServer();
    registerCreateLocalExtensionTool(server as never, makeOpts());
    expect([...tools.keys()]).toEqual(['create_local_extension']);
  });

  it('creates the extension and reports its id, workingDir, and next steps', async () => {
    const createLocalExtension = vi.fn(async () => ({
      ok: true as const,
      value: { id: 'my-ext-a1b2', workingDir: '/home/u/zcc-workspace/extensions/my-ext-a1b2', projectId: 'proj-1' }
    }));
    const { server, tools } = fakeServer();
    registerCreateLocalExtensionTool(server as never, makeOpts({ createLocalExtension }));

    const res = await tools.get('create_local_extension')!({ name: 'My Ext' });
    expect(res.isError).toBeFalsy();
    expect(createLocalExtension).toHaveBeenCalledWith({ name: 'My Ext', description: undefined, kind: undefined });
    expect(text(res)).toContain('my-ext-a1b2');
    expect(text(res)).toContain('/home/u/zcc-workspace/extensions/my-ext-a1b2');
    expect(text(res)).toContain('install_local_extension');
  });

  it('passes description and kind through when supplied', async () => {
    const createLocalExtension = vi.fn(async () => ({
      ok: true as const,
      value: { id: 'my-ext-a1b2', workingDir: '/w', projectId: 'proj-1' }
    }));
    const { server, tools } = fakeServer();
    registerCreateLocalExtensionTool(server as never, makeOpts({ createLocalExtension }));

    await tools.get('create_local_extension')!({
      name: 'My Ext',
      description: 'does things',
      kind: 'main-panel'
    });
    expect(createLocalExtension).toHaveBeenCalledWith({
      name: 'My Ext',
      description: 'does things',
      kind: 'main-panel'
    });
  });

  it('surfaces a typed failure (e.g. BAD_NAME) as isError, without throwing', async () => {
    const createLocalExtension = vi.fn(async () => ({
      ok: false as const,
      code: 'BAD_NAME',
      message: 'A name is required'
    }));
    const { server, tools } = fakeServer();
    registerCreateLocalExtensionTool(server as never, makeOpts({ createLocalExtension }));

    const res = await tools.get('create_local_extension')!({ name: '' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('A name is required');
  });
});
