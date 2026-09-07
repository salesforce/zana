import { describe, expect, it, vi } from 'vitest';
import {
  createModernTeamLaunchSource,
  modernTeamLaunchRoute,
  MODERN_TEAM_LAUNCH_TOOL_NAMES,
  MODERN_OWNER_EXECUTION_TOOL_NAMES,
  type CallMcpToolArgs,
  type ModernTeamLaunchConfig
} from './modern-team-launch-tools.js';
import type { PluginAgentToolContext } from '@zana-ai/zcc-plugin-sdk/server';

const ctx = (over: Partial<PluginAgentToolContext> = {}): PluginAgentToolContext => ({
  threadId: 'thread-1',
  projectId: 'project-1',
  signal: new AbortController().signal,
  ...over
});

function source(
  config: ModernTeamLaunchConfig,
  callMcpTool: (args: CallMcpToolArgs) => Promise<{ ok: boolean; text: string }>
) {
  return createModernTeamLaunchSource({
    getConfig: () => config,
    credentialFor: (sessionId) => `cred-for-${sessionId}`,
    callMcpTool
  });
}

const tool = (src: ReturnType<typeof source>, name: string) => {
  const found = src.tools.find((t) => t.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
};

describe('modernTeamLaunchRoute', () => {
  it('builds the credentialed loopback route with encoded segments', () => {
    expect(modernTeamLaunchRoute('http://127.0.0.1:5123', 'proj/1', 'thread 2', 'ab+cd')).toBe(
      'http://127.0.0.1:5123/mcp/proj%2F1/thread%202/ab%2Bcd'
    );
  });

  it('strips a trailing slash from the base', () => {
    expect(modernTeamLaunchRoute('http://127.0.0.1:5123/', 'p', 't', 'c')).toBe('http://127.0.0.1:5123/mcp/p/t/c');
  });
});

describe('createModernTeamLaunchSource', () => {
  it('registers launch_team siblings plus raw owner execution verbs', () => {
    const src = source({ mcpBaseUrl: 'http://127.0.0.1:1', teamLaunchEnabled: true, teamJobLaunchEnabled: true }, async () => ({ ok: true, text: '{}' }));
    expect(src.tools.map((t) => t.name).sort()).toEqual(
      [
        ...MODERN_TEAM_LAUNCH_TOOL_NAMES,
        ...MODERN_OWNER_EXECUTION_TOOL_NAMES
      ].sort()
    );
  });

  it('forwards to the credentialed loopback route, passing tool name + input', async () => {
    const calls: CallMcpToolArgs[] = [];
    const src = source({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true }, async (args) => {
      calls.push(args);
      return { ok: true, text: '{"launched":2}' };
    });
    const result = await tool(src, 'launch_team').execute({ teamId: 't', launchRequestId: 'r', slots: [] }, ctx());
    expect(result).toBe('{"launched":2}');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('launch_team');
    expect(calls[0].input).toEqual({ teamId: 't', launchRequestId: 'r', slots: [] });
    // credential derived from ctx.threadId, identity from ctx (never input)
    expect(calls[0].url).toBe('http://127.0.0.1:9/mcp/project-1/thread-1/cred-for-thread-1');
  });

  it('forwards execution.start when job launch is enabled', async () => {
    const calls: CallMcpToolArgs[] = [];
    const src = source(
      { mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: false, teamJobLaunchEnabled: true },
      async (args) => {
        calls.push(args);
        return { ok: true, text: '{"id":"execution-1","state":"RUNNING"}' };
      }
    );
    const result = await tool(src, 'execution_start').execute({ requestPath: '/tmp/req.json' }, ctx());
    expect(result).toBe('{"id":"execution-1","state":"RUNNING"}');
    expect(calls[0].name).toBe('execution.start');
    expect(calls[0].input).toEqual({ requestPath: '/tmp/req.json' });
  });

  it('does not call the route when job launch is disabled', async () => {
    const spy = vi.fn(async () => ({ ok: true, text: '{}' }));
    const src = source({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true }, spy);
    const result = await tool(src, 'execution_start').execute({ requestPath: '/tmp/req.json' }, ctx());
    expect(result).toEqual({ ok: false, message: 'execution_start unavailable: team job launch is disabled.' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('surfaces a route failure as a failed tool result', async () => {
    const src = source({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true }, async () => ({
      ok: false,
      text: 'launch_team failed: role target unavailable'
    }));
    const result = await tool(src, 'launch_team').execute({}, ctx());
    expect(result).toEqual({ ok: false, message: 'launch_team failed: role target unavailable' });
  });

  it('does not call the route when team launch is disabled', async () => {
    const spy = vi.fn(async () => ({ ok: true, text: '{}' }));
    const src = source({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: false }, spy);
    const result = await tool(src, 'launch_team').execute({}, ctx());
    expect(result).toEqual({ ok: false, message: 'launch_team unavailable: team launch is disabled.' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('does not call the route before the loopback endpoint is known', async () => {
    const spy = vi.fn(async () => ({ ok: true, text: '{}' }));
    const src = source({ mcpBaseUrl: undefined, teamLaunchEnabled: true }, spy);
    const result = await tool(src, 'get_team_launch').execute({ launchRequestId: 'r' }, ctx());
    expect(result).toEqual({ ok: false, message: 'get_team_launch unavailable: team launch endpoint is not ready yet.' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('wraps a thrown transport error as a failed tool result', async () => {
    const src = source({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true }, async () => {
      throw new Error('connection refused');
    });
    const result = await tool(src, 'launch_team').execute({}, ctx());
    expect(result).toEqual({ ok: false, message: 'launch_team failed: connection refused' });
  });

  describe('configurer visibility gate', () => {
    const run = (config: ModernTeamLaunchConfig) => {
      const src = source(config, async () => ({ ok: true, text: '{}' }));
      const configure = src.configurers?.[0];
      if (!configure) throw new Error('missing configurer');
      return configure({ threadId: 'thread-1', projectId: 'project-1' });
    };

    it('shows launch_team tools when team launch is on', async () => {
      expect(await run({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true })).toEqual({
        tools: [...MODERN_TEAM_LAUNCH_TOOL_NAMES]
      });
    });

    it('shows owner execution verbs when job launch is on', async () => {
      expect(await run({
        mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: false, teamJobLaunchEnabled: true
      })).toEqual({
        tools: [...MODERN_OWNER_EXECUTION_TOOL_NAMES]
      });
    });

    it('shows both sets when both flags are on', async () => {
      expect(await run({
        mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true, teamJobLaunchEnabled: true
      })).toEqual({
        tools: [
          ...MODERN_TEAM_LAUNCH_TOOL_NAMES,
          ...MODERN_OWNER_EXECUTION_TOOL_NAMES
        ]
      });
    });

    it('hides all tools when disabled', async () => {
      expect(await run({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: false })).toEqual({ tools: [] });
    });

    it('hides all tools before the endpoint is known', async () => {
      expect(await run({ mcpBaseUrl: undefined, teamLaunchEnabled: true, teamJobLaunchEnabled: true })).toEqual({ tools: [] });
    });
  });
});

describe('Modern owner execution catalog', () => {
  it('keeps raw MCP names for client-side server prefixing', async () => {
    const { resolvePluginSessionTools } = await import('../../plugins/plugin-agent-tools.js');
    const src = source(
      { mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: false, teamJobLaunchEnabled: true },
      async () => ({ ok: true, text: '{}' })
    );
    const session = await resolvePluginSessionTools([src], { threadId: 'thread-1', projectId: 'project-1' });
    expect(session.tools.map((row) => row.name)).toEqual([
      'execution_start',
      'execution_snapshot',
      'execution_resume_binding'
    ]);
    expect(session.tools[0]?.inputSchema).toMatchObject({
      properties: {
        jobTitle: { type: 'string' },
        maxConcurrent: { type: 'number' },
        workUnits: { type: 'array' }
      },
      required: ['version', 'teamId', 'launchRequestId', 'slots']
    });
  });
});
