import { describe, expect, it, vi } from 'vitest';
import {
  registerCloneProjectTool,
  type RegisterCloneProjectOpts
} from '../clone-project-mcp-tool.js';

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

function makeOpts(over: Partial<RegisterCloneProjectOpts> = {}): RegisterCloneProjectOpts {
  return {
    cloneProject: vi.fn(async () => ({
      ok: true as const,
      project: {
        id: 'project-1',
        name: 'sf-pi',
        path: '/Users/example/zcc-workspace/sf-pi',
        createdAt: 0,
        lastActiveAt: 0
      }
    })),
    ...over
  };
}

describe('registerCloneProjectTool', () => {
  it('clones into the configured clone root and registers the repository project', async () => {
    const cloneProject = vi.fn(async () => ({
      ok: true as const,
      project: {
        id: 'project-1',
        name: 'sf-pi',
        path: '/Users/example/zcc-workspace/sf-pi',
        createdAt: 0,
        lastActiveAt: 0
      }
    }));
    const { server, tools } = fakeServer();
    registerCloneProjectTool(server as never, makeOpts({ cloneProject }));

    const res = await tools.get('clone_project')!({
      url: 'https://github.com/salesforce/sf-pi.git'
    });

    expect(res.isError).toBeFalsy();
    expect(cloneProject).toHaveBeenCalledWith({
      url: 'https://github.com/salesforce/sf-pi.git',
      name: undefined
    });
    expect(text(res)).toContain('Cloned and registered project "sf-pi"');
    expect(text(res)).toContain('/Users/example/zcc-workspace/sf-pi');
  });

  it('reports registration instead of cloning when it reuses a matching repository', async () => {
    const cloneProject = vi.fn(async () => ({
      ok: true as const,
      reused: true,
      project: {
        id: 'project-1',
        name: 'sf-pi',
        path: '/Users/example/zcc-workspace/sf-pi',
        createdAt: 0,
        lastActiveAt: 0
      }
    }));
    const { server, tools } = fakeServer();
    registerCloneProjectTool(server as never, makeOpts({ cloneProject }));

    const res = await tools.get('clone_project')!({ url: 'salesforce/sf-pi' });

    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('Registered existing project "sf-pi"');
  });

  it('surfaces a destination collision without registering a new project', async () => {
    const cloneProject = vi.fn(async () => ({
      ok: false as const,
      code: 'DEST_EXISTS' as const,
      message: 'A folder already exists at /Users/example/zcc-workspace/sf-pi',
      path: '/Users/example/zcc-workspace/sf-pi'
    }));
    const { server, tools } = fakeServer();
    registerCloneProjectTool(server as never, makeOpts({ cloneProject }));

    const res = await tools.get('clone_project')!({ url: 'salesforce/sf-pi' });

    expect(res.isError).toBe(true);
    expect(text(res)).toContain('already exists');
  });
});
