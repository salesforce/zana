import { describe, expect, it, vi } from 'vitest';
import {
  createModernTeamLaunchSource,
  modernTeamLaunchRoute,
  MODERN_TEAM_LAUNCH_TOOL_NAMES,
  MODERN_OWNER_EXECUTION_TOOL_NAMES,
  type CallMcpToolArgs,
  type ModernTeamLaunchConfig,
  type ModernTeamMember,
  modernTeamMemberRoute
} from './modern-team-launch-tools.js';
import { EXECUTION_MEMBER_TOOL_NAMES, getExecutionToolDescriptors } from '../execution/execution-mcp-tool.js';
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
        ...new Set([...MODERN_OWNER_EXECUTION_TOOL_NAMES, ...Object.values(EXECUTION_MEMBER_TOOL_NAMES).flat().map((name) => name.replaceAll('.', '_'))])
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

  it('preserves admissionDigest on the Modern launch_team surface', async () => {
    const calls: CallMcpToolArgs[] = [];
    const src = source({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true }, async (args) => {
      calls.push(args);
      return { ok: true, text: '{}' };
    });
    await tool(src, 'launch_team').execute({
      teamId: 't', launchRequestId: 'r', admissionDigest: 'admission-1', slots: []
    }, ctx());
    expect(calls[0].input).toMatchObject({ admissionDigest: 'admission-1' });
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

describe('Modern member execution catalog', () => {
  const config = { mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true, teamJobLaunchEnabled: true };
  const member: ModernTeamMember = { bindingId: 'binding-1', generation: 1, role: 'worker', executionId: 'execution-1' };
  const configureContext = { threadId: 'thread-1', projectId: 'project-1' };

  function memberSource(resolveMember = vi.fn(async () => member as ModernTeamMember | undefined)) {
    const callMcpTool = vi.fn(async (_args: CallMcpToolArgs) => ({ ok: true, text: '{}' }));
    const src = createModernTeamLaunchSource({ getConfig: () => config, resolveMember, credentialFor: () => 'credential', callMcpTool });
    return { src, resolveMember, callMcpTool };
  }

  it.each(['worker', 'orchestrator'] as const)('exposes only %s role tools even with both owner flags enabled', async (role) => {
    const { src } = memberSource(vi.fn(async () => ({ ...member, role })));
    const configured = await src.configurers![0](configureContext);
    expect(configured).toEqual({ tools: EXECUTION_MEMBER_TOOL_NAMES[role].map((name) => name.replaceAll('.', '_')) });
    expect(configured?.tools).not.toContain('execution_start');
    expect(configured?.tools).not.toContain('launch_team');
  });

  it('reuses canonical member schemas and keeps identity out of arguments', () => {
    const { src } = memberSource();
    for (const descriptor of getExecutionToolDescriptors()) {
      if (!Object.values(EXECUTION_MEMBER_TOOL_NAMES).flat().some((name) => name === descriptor.name) || descriptor.name === 'execution.snapshot') continue;
      if (descriptor.name === 'execution.event') {
        expect(tool(src, 'execution_event').inputSchema).toEqual({ ...descriptor.inputSchema, properties: Object.fromEntries(
          Object.entries(descriptor.inputSchema.properties as Record<string, unknown>).filter(([key]) => key !== 'slotId' && key !== 'producerRole')
        ) });
      } else expect(tool(src, descriptor.name.replaceAll('.', '_')).inputSchema).toEqual(descriptor.inputSchema);
      expect(descriptor.schema.safeParse({ executionId: 'execution-1', projectId: 'forged' }).success).toBe(false);
    }
  });

  it('forwards using trusted thread identity and configured generation without passing route fields in args', async () => {
    const { src, resolveMember, callMcpTool } = memberSource();
    await src.configurers![0](configureContext);
    const input = { executionId: 'execution-1', workUnitId: 'unit-1' };
    await expect(tool(src, 'execution_work_claim').execute(input, ctx())).resolves.toBe('{}');
    expect(resolveMember).toHaveBeenCalledWith('thread-1', 'project-1');
    expect(callMcpTool).toHaveBeenCalledWith({
      url: 'http://127.0.0.1:9/mcp/project-1/thread-1/credential/member/binding-1/1',
      name: 'execution.work.claim', input, signal: expect.any(AbortSignal)
    });
    expect(modernTeamMemberRoute('http://127.0.0.1:9', 'p', 't', 'c', { bindingId: 'bind/1', generation: 2 }))
      .toBe('http://127.0.0.1:9/mcp/p/t/c/member/bind%2F1/2');
  });

  it.each(['execution_start', 'execution_resume_binding', 'launch_team', 'execution_plan_register'])('rejects direct member invocation of %s', async (name) => {
    const { src, callMcpTool } = memberSource();
    await src.configurers![0](configureContext);
    await expect(tool(src, name).execute({}, ctx())).resolves.toMatchObject({ ok: false });
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it.each([
    { ...member, generation: 2 }, { ...member, bindingId: 'binding-2' },
    { ...member, role: 'orchestrator' as const }, { ...member, executionId: 'execution-2' }, undefined
  ])('fails closed when configured membership changes to %j', async (changed) => {
    const { src, resolveMember, callMcpTool } = memberSource();
    await src.configurers![0](configureContext);
    resolveMember.mockResolvedValue(changed);
    expect(await src.configurers![0](configureContext)).toEqual({ tools: [] });
    await expect(tool(src, 'execution_snapshot').execute({ executionId: 'execution-1' }, ctx())).resolves.toMatchObject({ ok: false });
    await expect(tool(src, 'execution_start').execute({ requestPath: '/tmp/req' }, ctx())).resolves.toMatchObject({ ok: false });
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it('denies unconfigured members, wrong execution, and input identity overrides', async () => {
    const { src, callMcpTool } = memberSource();
    await expect(tool(src, 'execution_work_claim').execute({ executionId: 'execution-1', workUnitId: 'u' }, ctx())).resolves.toMatchObject({ ok: false });
    await src.configurers![0](configureContext);
    for (const input of [
      { executionId: 'execution-2', workUnitId: 'u' },
      { executionId: 'execution-1', workUnitId: 'u', generation: 2 },
      { executionId: 'execution-1', workUnitId: 'u', threadId: 'forged' }
    ]) await expect(tool(src, 'execution_work_claim').execute(input, ctx())).resolves.toMatchObject({ ok: false });
    await expect(tool(src, 'execution_event').execute({ executionId: 'execution-1', slotId: 'forged', producerRole: 'orchestrator' }, ctx())).resolves.toMatchObject({ ok: false });
    expect(callMcpTool).not.toHaveBeenCalled();
  });

  it('keeps bound member tools available when owner launch flags turn off', async () => {
    const { src, callMcpTool } = memberSource();
    await src.configurers![0](configureContext);
    config.teamLaunchEnabled = false;
    config.teamJobLaunchEnabled = false;
    try {
      await expect(tool(src, 'execution_delivery_pull').execute({}, ctx())).resolves.toBe('{}');
      expect(callMcpTool).toHaveBeenCalledOnce();
    } finally {
      config.teamLaunchEnabled = true;
      config.teamJobLaunchEnabled = true;
    }
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
    expect(session.tools[0]?.inputSchema).toEqual(getExecutionToolDescriptors().find((descriptor) => descriptor.name === 'execution.start')!.inputSchema);
  });
});

describe('Modern forwarding transport', () => {
  it.each([
    { body: '{"result":{"content":[{"type":"text","text":"ok"},{"type":"image"},{"text":"more"}]}}', expected: 'ok\nmore' },
    { body: 'data: {"result":{"content":[{"text":"sse"}]}}\n\n', expected: 'sse' },
    { body: '{"result":{}}', expected: '{}' },
    { body: '{"result":{"isError":true,"content":[{"text":"denied"}]}}', expected: { ok: false, message: 'denied' } }
  ])('handles transport response $body', async ({ body, expected }) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    try {
      const src = createModernTeamLaunchSource({ getConfig: () => ({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true }), credentialFor: () => 'credential' });
      const result = await tool(src, 'get_team_launch').execute({ launchRequestId: 'r' }, ctx());
      expect(result).toEqual(expected);
      expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9/mcp/project-1/thread-1/credential', expect.objectContaining({
        method: 'POST', signal: expect.any(AbortSignal),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_team_launch', arguments: { launchRequestId: 'r' } } })
      }));
    } finally { fetch.mockRestore(); }
  });

  it.each([
    { body: '{}', status: 503, message: 'loopback MCP call failed: 503' },
    { body: '{"error":{"message":"rpc denied"}}', status: 200, message: 'rpc denied' },
    { body: '{"error":{}}', status: 200, message: 'loopback MCP request failed' }
  ])('returns transport failure $message', async ({ body, status, message }) => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status }));
    try {
      const src = createModernTeamLaunchSource({ getConfig: () => ({ mcpBaseUrl: 'http://127.0.0.1:9', teamLaunchEnabled: true }), credentialFor: () => 'credential' });
      await expect(tool(src, 'get_team_launch').execute({}, ctx())).resolves.toEqual({ ok: false, message: `get_team_launch failed: ${message}` });
    } finally { fetch.mockRestore(); }
  });
});
