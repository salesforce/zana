import { describe, expect, it } from 'vitest';
import { registerPreviewFileTool } from './preview-file-mcp-tool.js';

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

describe('registerPreviewFileTool', () => {
  it('fails closed when no preview host is registered', async () => {
    const { server, tools } = fakeServer();
    registerPreviewFileTool(server as never, { threadId: 'thr_1', projectId: 'proj_1' });
    const res = await tools.get('preview_file')!({ path: 'src/a.ts' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('desktop app');
  });

  it('opens through the session thread id and ignores a forged threadId field', async () => {
    const calls: unknown[] = [];
    const { server, tools } = fakeServer();
    registerPreviewFileTool(server as never, {
      threadId: 'thr_1',
      projectId: 'proj_1',
      previewFile: async (input) => {
        calls.push(input);
        return { delivered: 1, path: input.path, source: input.source };
      }
    });
    const opened = payload(await tools.get('preview_file')!({
      path: 'src/a.ts',
      threadId: 'other-thread',
      lineNumber: 4
    }));
    expect(opened).toEqual({ ok: true, path: 'src/a.ts', source: 'workspace' });
    expect(calls).toEqual([{
      threadId: 'thr_1',
      projectId: 'proj_1',
      source: 'workspace',
      path: 'src/a.ts',
      lineNumber: 4
    }]);
  });

  it('errors when no app window is connected', async () => {
    const { server, tools } = fakeServer();
    registerPreviewFileTool(server as never, {
      threadId: 'thr_1',
      projectId: 'proj_1',
      previewFile: async (input) => ({ delivered: 0, path: input.path, source: input.source })
    });
    const res = await tools.get('preview_file')!({ path: 'src/a.ts' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('desktop app open');
  });
});
