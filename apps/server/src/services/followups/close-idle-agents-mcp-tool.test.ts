import { describe, it, expect, vi } from 'vitest';
import {
  registerCloseIdleAgentsTools,
  type RegisterCloseIdleAgentsToolsOpts,
  type CloseIdleProjectResult
} from './close-idle-agents-mcp-tool.js';

/**
 * Minimal fake McpServer that captures registered tool handlers, so we invoke
 * each directly without an HTTP transport. Mirrors the close-session test.
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

function makeOpts(
  over: Partial<RegisterCloseIdleAgentsToolsOpts> = {}
): RegisterCloseIdleAgentsToolsOpts {
  return {
    sessionId: 'caller',
    projectId: 'p1',
    findIdleAgents: vi.fn(() => new Map<string, string[]>([['p1', ['idle-1', 'idle-2']]])),
    summarizeAndClose: vi.fn(
      async (_pid, ids): Promise<CloseIdleProjectResult> => ({
        closed: ids.length,
        summarized: ids.length,
        body: 'wrap-up body'
      })
    ),
    ...over
  };
}

describe('registerCloseIdleAgentsTools', () => {
  it('registers the close_idle_agents tool', () => {
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts());
    expect([...tools.keys()]).toEqual(['close_idle_agents']);
  });

  it('passes caller identity + default scope (own project) to the resolver', async () => {
    const findIdleAgents = vi.fn(() => new Map<string, string[]>([['p1', ['idle-1']]]));
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ findIdleAgents }));
    await tools.get('close_idle_agents')!({});
    expect(findIdleAgents).toHaveBeenCalledWith({
      callerSessionId: 'caller',
      callerProjectId: 'p1',
      allProjects: false
    });
  });

  it('widens scope when allProjects is true', async () => {
    const findIdleAgents = vi.fn(() => new Map<string, string[]>());
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ findIdleAgents }));
    await tools.get('close_idle_agents')!({ allProjects: true });
    expect(findIdleAgents).toHaveBeenCalledWith(
      expect.objectContaining({ allProjects: true })
    );
  });

  it('summarizes by default and returns the wrap-up body to the agent', async () => {
    const summarizeAndClose = vi.fn(
      async (_pid: string, ids: string[]): Promise<CloseIdleProjectResult> => ({
        closed: ids.length,
        summarized: ids.length,
        body: 'WRAP-UP-P1'
      })
    );
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ summarizeAndClose }));
    const res = await tools.get('close_idle_agents')!({});
    expect(summarizeAndClose).toHaveBeenCalledWith('p1', ['idle-1', 'idle-2'], { summarize: true });
    const out = text(res);
    expect(out).toContain('Closed 2 idle agents');
    expect(out).toContain('WRAP-UP-P1'); // body handed back for the agent to persist
  });

  it('honours summarize:false — no summary, no body in the reply', async () => {
    const summarizeAndClose = vi.fn(
      async (_pid: string, ids: string[]): Promise<CloseIdleProjectResult> => ({
        closed: ids.length,
        summarized: 0
      })
    );
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ summarizeAndClose }));
    const res = await tools.get('close_idle_agents')!({ summarize: false });
    expect(summarizeAndClose).toHaveBeenCalledWith('p1', ['idle-1', 'idle-2'], {
      summarize: false
    });
    const out = text(res);
    expect(out).toContain('Closed 2 idle agents');
    expect(out).not.toContain('wrap-up');
  });

  it('does not promise a wrap-up when summaries ran but produced none', async () => {
    // summarize requested, agents closed, but no transcript → no body.
    const summarizeAndClose = vi.fn(
      async (_pid: string, ids: string[]): Promise<CloseIdleProjectResult> => ({
        closed: ids.length,
        summarized: 0
      })
    );
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ summarizeAndClose }));
    const res = await tools.get('close_idle_agents')!({});
    const out = text(res);
    expect(out).toContain('Closed 2 idle agents');
    // Must NOT dangle a "wrap-up(s) above / store in memory" line with nothing above it.
    expect(out).not.toContain('wrap-up');
    expect(out).not.toContain('project memory');
    expect(out).toContain('No work summaries were produced');
  });

  it('reports "nothing to close" when the resolver finds no idle agents', async () => {
    const summarizeAndClose = vi.fn();
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(
      server as never,
      makeOpts({
        findIdleAgents: () => new Map<string, string[]>(),
        summarizeAndClose
      })
    );
    const res = await tools.get('close_idle_agents')!({});
    expect(summarizeAndClose).not.toHaveBeenCalled();
    expect(text(res)).toContain('No idle agents to close in this project.');
  });

  it('closes across multiple projects and aggregates the counts', async () => {
    const findIdleAgents = vi.fn(
      () =>
        new Map<string, string[]>([
          ['p1', ['a']],
          ['p2', ['b', 'c']]
        ])
    );
    const summarizeAndClose = vi.fn(
      async (pid: string, ids: string[]): Promise<CloseIdleProjectResult> => ({
        closed: ids.length,
        summarized: ids.length,
        body: `wrap-${pid}`
      })
    );
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ findIdleAgents, summarizeAndClose }));
    const res = await tools.get('close_idle_agents')!({ allProjects: true });
    expect(summarizeAndClose).toHaveBeenCalledTimes(2);
    const out = text(res);
    expect(out).toContain('Closed 3 idle agents across 2 projects');
    expect(out).toContain('wrap-p1');
    expect(out).toContain('wrap-p2');
  });

  it("one project's close failure doesn't sink the others", async () => {
    const findIdleAgents = vi.fn(
      () =>
        new Map<string, string[]>([
          ['p1', ['a']],
          ['p2', ['b']]
        ])
    );
    const summarizeAndClose = vi.fn(async (pid: string): Promise<CloseIdleProjectResult> => {
      if (pid === 'p1') throw new Error('boom');
      return { closed: 1, summarized: 1, body: 'wrap-p2' };
    });
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ findIdleAgents, summarizeAndClose }));
    const res = await tools.get('close_idle_agents')!({ allProjects: true });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain('Closed 1 idle agent across 2 projects');
  });

  it('errors when there is no originating session', async () => {
    const { server, tools } = fakeServer();
    registerCloseIdleAgentsTools(server as never, makeOpts({ sessionId: undefined }));
    const res = await tools.get('close_idle_agents')!({});
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('no originating session');
  });
});
