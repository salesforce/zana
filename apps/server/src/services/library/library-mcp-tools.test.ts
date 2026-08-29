import { describe, it, expect, vi } from 'vitest';
import {
  registerLibraryTools,
  type RegisterLibraryToolsOpts,
  type LibraryAgentApi
} from './library-mcp-tools.js';
import type { LibraryDoc } from '@zana-ai/zcc-domain/product';

/**
 * Minimal fake McpServer that captures registered tool handlers so we invoke
 * each directly without an HTTP transport. Mirrors the launch-team /
 * close-idle-agents tests.
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

function text(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content.find((c) => c.type === 'text')?.text ?? '';
}

function makeDoc(over: Partial<LibraryDoc> = {}): LibraryDoc {
  return {
    relPath: 'findings/auth.md',
    title: 'Auth findings',
    summary: 'what we learned',
    tags: ['findings'],
    kind: 'agent',
    bytes: 42,
    updatedAt: '2026-06-21T00:00:00.000Z',
    ...over
  } as LibraryDoc;
}

/** A stub agent API whose methods are vi.fn()s we can assert/override. */
function makeApi(over: Partial<LibraryAgentApi> = {}): LibraryAgentApi {
  return {
    agentList: vi.fn(() => [makeDoc()]),
    agentRead: vi.fn(() => ({ ...makeDoc(), content: '# Auth\nbody' })),
    agentWrite: vi.fn(() => makeDoc()),
    agentRemove: vi.fn(() => true),
    ...over
  };
}

function makeOpts(over: Partial<RegisterLibraryToolsOpts> = {}): RegisterLibraryToolsOpts {
  return {
    projectId: 'proj-1',
    sessionId: 'sess-1',
    libraryAgentApi: makeApi(),
    ...over
  };
}

describe('registerLibraryTools', () => {
  it('registers exactly the four library_* tools', () => {
    const { server, tools } = fakeServer();
    registerLibraryTools(server as never, makeOpts());
    expect([...tools.keys()].sort()).toEqual([
      'library_list',
      'library_read',
      'library_remove',
      'library_write'
    ]);
  });

  it('library_write passes the route projectId + sessionId, never agent input', async () => {
    const agentWrite = vi.fn(() => makeDoc({ relPath: 'notes/x.md', bytes: 10 }));
    const { server, tools } = fakeServer();
    registerLibraryTools(
      server as never,
      makeOpts({ projectId: 'proj-1', sessionId: 'sess-1', libraryAgentApi: makeApi({ agentWrite }) })
    );
    const res = await tools.get('library_write')!({
      relPath: 'notes/x.md',
      content: 'hi',
      // An attacker-supplied projectId/sessionId must be ignored — the tool
      // closes over identity from the route, not the args.
      projectId: 'other-proj',
      sessionId: 'spoofed'
    });
    expect(agentWrite).toHaveBeenCalledWith('proj-1', 'sess-1', {
      relPath: 'notes/x.md',
      title: undefined,
      content: 'hi',
      summary: undefined,
      tags: undefined
    });
    expect(text(res)).toContain('Saved "notes/x.md"');
    expect(res.isError).toBeFalsy();
  });

  it('library_read returns content + metadata and errors on a missing doc', async () => {
    const agentRead = vi
      .fn()
      .mockReturnValueOnce({ ...makeDoc(), content: 'BODY' })
      .mockReturnValueOnce(null);
    const { server, tools } = fakeServer();
    registerLibraryTools(server as never, makeOpts({ libraryAgentApi: makeApi({ agentRead }) }));

    const ok = await tools.get('library_read')!({ relPath: 'findings/auth.md' });
    expect(agentRead).toHaveBeenCalledWith('proj-1', 'findings/auth.md');
    const parsed = JSON.parse(text(ok));
    expect(parsed.content).toBe('BODY');
    expect(parsed.relPath).toBe('findings/auth.md');

    const missing = await tools.get('library_read')!({ relPath: 'nope.md' });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toContain('no such doc');
  });

  it('library_list summarizes docs and omits file content', async () => {
    const { server, tools } = fakeServer();
    registerLibraryTools(server as never, makeOpts());
    const res = await tools.get('library_list')!({});
    const parsed = JSON.parse(text(res));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].relPath).toBe('findings/auth.md');
    expect(parsed[0]).not.toHaveProperty('content');
  });

  it('library_remove reports removed vs not-found', async () => {
    const agentRemove = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
    const { server, tools } = fakeServer();
    registerLibraryTools(server as never, makeOpts({ libraryAgentApi: makeApi({ agentRemove }) }));

    const removed = await tools.get('library_remove')!({ relPath: 'findings/auth.md' });
    expect(agentRemove).toHaveBeenCalledWith('proj-1', 'findings/auth.md');
    expect(text(removed)).toContain('Removed "findings/auth.md"');

    const none = await tools.get('library_remove')!({ relPath: 'ghost.md' });
    expect(text(none)).toContain('No such doc');
  });

  it('a throwing store surfaces as an isError result, not an exception', async () => {
    const agentWrite = vi.fn(() => {
      throw new Error('confinement violation');
    });
    const { server, tools } = fakeServer();
    registerLibraryTools(server as never, makeOpts({ libraryAgentApi: makeApi({ agentWrite }) }));
    const res = await tools.get('library_write')!({ relPath: '../escape.md', content: 'x' });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('library_write failed: confinement violation');
  });

  it('forwards a missing sessionId as undefined (write still wired, store decides)', async () => {
    const agentWrite = vi.fn(() => makeDoc());
    const { server, tools } = fakeServer();
    registerLibraryTools(
      server as never,
      makeOpts({ sessionId: undefined, libraryAgentApi: makeApi({ agentWrite }) })
    );
    await tools.get('library_write')!({ relPath: 'a.md', content: 'x' });
    expect(agentWrite).toHaveBeenCalledWith('proj-1', undefined, expect.objectContaining({ relPath: 'a.md' }));
  });
});
