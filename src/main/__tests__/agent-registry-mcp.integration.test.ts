/**
 * End-to-end integration tests for the agent-registry discovery tools
 * (register_agent / list_agents / find_agent), Phase 0 of the inter-agent mesh.
 *
 * Boots the real http listener via startMcpServer() and drives it with a
 * genuine MCP client over StreamableHTTP. Asserts:
 *   1. works  — register → discover round-trips; live status is fused in.
 *   2. safe   — sessionId/projectId come from the URL, never the agent; the
 *               tools are session-scoped only (absent on the project route).
 *   3. scope  — discovery defaults to own-project; allProjects widens it; an
 *               agent never lists itself.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer, type McpServerHandle } from '../mcp-server.js';
import { createMemoryInboxStore } from '../inbox-store.js';
import { createMemorySuggestionsStore } from '../suggestions-store.js';
import { createAgentRegistryStore, type IAgentRegistryStore } from '../agent-registry-store.js';
import type { AgentState, Project } from '../../shared/types.js';

function makeProject(id: string, name: string): Project {
  return { id, name, path: `/tmp/${id}`, createdAt: 0, lastActiveAt: 0 };
}

async function connectClient(baseUrl: string, path: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${path}`));
  await client.connect(transport);
  return client;
}

/** Parse the JSON array a list/find tool returns in its text content. */
function parsePeers(res: unknown): Array<Record<string, unknown>> {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === 'text')?.text ?? '[]';
  return JSON.parse(text);
}

describe('agent-registry MCP tools (end-to-end)', () => {
  let handle: McpServerHandle | null = null;
  const clients: Client[] = [];

  afterEach(async () => {
    for (const c of clients.splice(0)) {
      try {
        await c.close();
      } catch {
        /* ignore */
      }
    }
    if (handle) {
      await handle.close();
      handle = null;
    }
  });

  async function boot(opts: {
    registry: IAgentRegistryStore;
    projects: Project[];
    cwdFor?: (sessionId: string) => string | undefined;
    statusFor?: (sessionId: string) => AgentState;
  }) {
    const map = new Map(opts.projects.map((p) => [p.id, p]));
    handle = await startMcpServer({
      inboxStore: createMemoryInboxStore(),
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: (id) => map.get(id) ?? null },
      agentRegistry: opts.registry,
      getSessionCwd: opts.cwdFor,
      getAgentStatus: opts.statusFor,
      log: () => {}
    });
    return handle;
  }

  it('1. works: register_agent persists with URL identity; schema hides ids', async () => {
    const registry = createAgentRegistryStore();
    const h = await boot({
      registry,
      projects: [makeProject('proj-1', 'P1')],
      cwdFor: (s) => (s === 'sess-A' ? '/work/p1' : undefined)
    });

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // Schema exposes only the soft fields — never identity.
    const tools = await client.listTools();
    const reg = tools.tools.find((t) => t.name === 'register_agent');
    expect(reg, 'register_agent registered').toBeTruthy();
    const props = (reg!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['capabilities', 'handle', 'role']);

    const res = await client.callTool({
      name: 'register_agent',
      arguments: { handle: 'reviewer', role: 'reviewer', capabilities: ['ts'] }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();

    const rec = registry.get('sess-A');
    expect(rec).toMatchObject({
      sessionId: 'sess-A',
      projectId: 'proj-1',
      cwd: '/work/p1',
      handle: 'reviewer',
      role: 'reviewer',
      capabilities: ['ts']
    });
  });

  it('2. safe: the agent cannot forge sessionId/projectId — only the URL counts', async () => {
    const registry = createAgentRegistryStore();
    const h = await boot({
      registry,
      projects: [makeProject('proj-1', 'P1'), makeProject('proj-2', 'P2')]
    });
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    await client.callTool({
      name: 'register_agent',
      arguments: {
        handle: 'sneaky',
        // not in the schema — smuggled on the wire
        sessionId: 'sess-EVIL',
        projectId: 'proj-2'
      }
    });

    // URL identity wins; the forgery is ignored.
    expect(registry.get('sess-EVIL')).toBeNull();
    expect(registry.get('sess-A')?.projectId).toBe('proj-1');
  });

  it('2b. safe: the discovery tools are NOT on the legacy project-scoped route', async () => {
    const registry = createAgentRegistryStore();
    const h = await boot({ registry, projects: [makeProject('proj-1', 'P1')] });
    const client = await connectClient(h.url, 'proj-1'); // no sessionId
    clients.push(client);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).not.toContain('register_agent');
    expect(names).not.toContain('list_agents');
    expect(names).not.toContain('find_agent');
    // inbox_push is still there on the project route.
    expect(names).toContain('inbox_push');
  });

  it('2c. safe: tools are absent entirely when no registry dep is wired', async () => {
    const h = await startMcpServer({
      inboxStore: createMemoryInboxStore(),
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: () => makeProject('proj-1', 'P1') },
      // agentRegistry omitted
      log: () => {}
    });
    handle = h;
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('register_agent');
  });

  it('3. works: list_agents returns peers with live status, excluding self', async () => {
    const registry = createAgentRegistryStore();
    // Pre-seed two peers (as the auto-seed at spawn would).
    registry.upsert({ sessionId: 'sess-A', projectId: 'proj-1', cwd: '/a', handle: 'me' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'proj-1', cwd: '/b', handle: 'impl', role: 'implementer' });

    const status: Record<string, AgentState> = { 'sess-A': 'working', 'sess-B': 'idle' };
    const h = await boot({
      registry,
      projects: [makeProject('proj-1', 'P1')],
      statusFor: (s) => status[s] ?? 'unknown'
    });

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const res = await client.callTool({ name: 'list_agents', arguments: {} });
    const peers = parsePeers(res);

    // Only the peer, not self.
    expect(peers).toHaveLength(1);
    expect(peers[0]).toMatchObject({ sessionId: 'sess-B', handle: 'impl', role: 'implementer' });
    // Live status fused in from the tracker (NOT stored on the record).
    expect(peers[0].status).toBe('idle');
  });

  it('3b. scope: list defaults to own project; allProjects widens it', async () => {
    const registry = createAgentRegistryStore();
    registry.upsert({ sessionId: 'sess-A', projectId: 'proj-1', cwd: '/a', handle: 'me' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'proj-1', cwd: '/b', handle: 'peer1' });
    registry.upsert({ sessionId: 'sess-C', projectId: 'proj-2', cwd: '/c', handle: 'peer2' });

    const h = await boot({
      registry,
      projects: [makeProject('proj-1', 'P1'), makeProject('proj-2', 'P2')]
    });
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    const own = parsePeers(await client.callTool({ name: 'list_agents', arguments: {} }));
    expect(own.map((p) => p.sessionId)).toEqual(['sess-B']); // proj-1 only, minus self

    const all = parsePeers(
      await client.callTool({ name: 'list_agents', arguments: { allProjects: true } })
    );
    expect(all.map((p) => p.sessionId).sort()).toEqual(['sess-B', 'sess-C']);
  });

  it('3c. works: find_agent resolves a peer by role within the project', async () => {
    const registry = createAgentRegistryStore();
    registry.upsert({ sessionId: 'sess-A', projectId: 'proj-1', cwd: '/a', handle: 'me' });
    registry.upsert({
      sessionId: 'sess-B',
      projectId: 'proj-1',
      cwd: '/b',
      handle: 'impl',
      role: 'implementer',
      capabilities: ['tests']
    });

    const h = await boot({
      registry,
      projects: [makeProject('proj-1', 'P1')],
      statusFor: () => 'idle'
    });
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    const byRole = parsePeers(
      await client.callTool({ name: 'find_agent', arguments: { role: 'implementer' } })
    );
    expect(byRole.map((p) => p.sessionId)).toEqual(['sess-B']);

    const byCap = parsePeers(
      await client.callTool({ name: 'find_agent', arguments: { capability: 'tests' } })
    );
    expect(byCap.map((p) => p.sessionId)).toEqual(['sess-B']);

    const none = parsePeers(
      await client.callTool({ name: 'find_agent', arguments: { role: 'nonexistent' } })
    );
    expect(none).toEqual([]);
  });

  it('3d. works: register_agent auto-suffixes a taken handle and reports it', async () => {
    const registry = createAgentRegistryStore();
    registry.upsert({ sessionId: 'sess-B', projectId: 'proj-1', cwd: '/b', handle: 'reviewer' });

    const h = await boot({ registry, projects: [makeProject('proj-1', 'P1')] });
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    const res = await client.callTool({
      name: 'register_agent',
      arguments: { handle: 'reviewer' }
    });
    expect(registry.get('sess-A')?.handle).toBe('reviewer-2');
    const text = JSON.stringify((res as { content?: unknown }).content ?? '');
    expect(text).toMatch(/reviewer-2/);
    expect(text).toMatch(/was taken/);
  });
});
