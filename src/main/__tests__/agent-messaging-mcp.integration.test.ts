/**
 * End-to-end integration tests for the agent messaging tools (agent_send /
 * agent_inbox), Phase 1 of the inter-agent mesh.
 *
 * The load-bearing assertions:
 *   - pull-first: an idle target gets the message injected; a busy target gets
 *     it QUEUED (never lost), retrievable via agent_inbox.
 *   - channel separation: routine peer traffic NEVER touches the user inbox.
 *   - identity: sender is the URL session; you can't message yourself; project
 *     scope holds unless allProjects is set.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer, type McpServerHandle } from '../mcp-server.js';
import { createMemoryInboxStore, type IInboxStore } from '../inbox-store.js';
import { createMemorySuggestionsStore } from '../suggestions-store.js';
import { createAgentRegistryStore, type IAgentRegistryStore } from '../agent-registry-store.js';
import { createAgentMessageLog, type IAgentMessageLog } from '../agent-message-log.js';
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

function parseJson(res: unknown): unknown {
  const content = (res as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === 'text')?.text ?? 'null';
  return JSON.parse(text);
}

describe('agent messaging MCP tools (end-to-end)', () => {
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
    inbox: IInboxStore;
    registry: IAgentRegistryStore;
    messageLog: IAgentMessageLog;
    projects: Project[];
    statusFor: (sessionId: string) => AgentState;
    injects: Array<{ sessionId: string; text: string }>;
    liveSessions?: Set<string>;
  }) {
    const map = new Map(opts.projects.map((p) => [p.id, p]));
    handle = await startMcpServer({
      inboxStore: opts.inbox,
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: (id) => map.get(id) ?? null },
      agentRegistry: opts.registry,
      getAgentStatus: opts.statusFor,
      agentMessageLog: opts.messageLog,
      injectToSession: (sessionId, text) => {
        // Mirror PtyManager.reply: only "live" sessions accept an inject.
        if (opts.liveSessions && !opts.liveSessions.has(sessionId)) return false;
        opts.injects.push({ sessionId, text });
        return true;
      },
      log: () => {}
    });
    return handle;
  }

  it('1. idle target: agent_send injects at the prompt AND audits to the log (not the inbox)', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'p1', cwd: '/b', handle: 'impl' });
    const injects: Array<{ sessionId: string; text: string }> = [];

    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1')],
      statusFor: () => 'idle', // target is idle → injectable
      injects,
      liveSessions: new Set(['sess-A', 'sess-B'])
    });

    const client = await connectClient(h.url, 'p1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'agent_send',
      arguments: { to: 'impl', message: 'please re-run the auth tests' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();

    // Injected into the target pty with a from-prefix.
    expect(injects).toHaveLength(1);
    expect(injects[0].sessionId).toBe('sess-B');
    expect(injects[0].text).toBe('[message from @reviewer] please re-run the auth tests');

    // Audited to the message log, marked delivered (it was injected).
    const hist = messageLog.history('p1');
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({
      fromSessionId: 'sess-A',
      fromHandle: 'reviewer',
      toSessionId: 'sess-B',
      toHandle: 'impl',
      body: 'please re-run the auth tests'
    });
    expect(hist[0].deliveredAt).toBeDefined();

    // THE channel-separation assertion: the user inbox is untouched.
    const { entries } = await inbox.read();
    expect(entries).toHaveLength(0);
  });

  it('1b. waiting target (non-OSC harness rest state): agent_send injects immediately', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'p1', cwd: '/b', handle: 'impl' });
    const injects: Array<{ sessionId: string; text: string }> = [];

    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1')],
      statusFor: () => 'waiting', // target is at rest (non-OSC harness) → injectable
      injects,
      liveSessions: new Set(['sess-A', 'sess-B'])
    });

    const client = await connectClient(h.url, 'p1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'agent_send',
      arguments: { to: 'impl', message: 'please re-run the auth tests' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const text = JSON.stringify((res as { content?: unknown }).content);
    expect(text).toMatch(/Delivered/);

    expect(injects).toHaveLength(1);
    expect(injects[0].sessionId).toBe('sess-B');

    const hist = messageLog.history('p1');
    expect(hist[0].deliveredAt).toBeDefined();
  });

  it('1c. blocked target: agent_send does NOT inject — stays queued', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'p1', cwd: '/b', handle: 'impl' });
    const injects: Array<{ sessionId: string; text: string }> = [];

    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1')],
      statusFor: () => 'blocked', // mid-permission-prompt → never injectable
      injects,
      liveSessions: new Set(['sess-A', 'sess-B'])
    });

    const client = await connectClient(h.url, 'p1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'agent_send',
      arguments: { to: 'impl', message: 'ping while blocked' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const text = JSON.stringify((res as { content?: unknown }).content);
    expect(text).toMatch(/Queued/);

    expect(injects).toHaveLength(0);
    const hist = messageLog.history('p1');
    expect(hist[0].deliveredAt).toBeUndefined();
  });

  it('2. busy target: agent_send QUEUES (no inject), and agent_inbox drains it', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'p1', cwd: '/b', handle: 'impl' });
    const injects: Array<{ sessionId: string; text: string }> = [];

    const status: Record<string, AgentState> = { 'sess-B': 'working' }; // busy → NOT injectable
    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1')],
      statusFor: (s) => status[s] ?? 'unknown',
      injects,
      liveSessions: new Set(['sess-A', 'sess-B'])
    });

    // Sender messages the busy target.
    const sender = await connectClient(h.url, 'p1/sess-A');
    clients.push(sender);
    const sent = await sender.callTool({
      name: 'agent_send',
      arguments: { to: 'impl', message: 'ping while busy' }
    });
    const sentText = JSON.stringify((sent as { content?: unknown }).content);
    expect(sentText).toMatch(/Queued/);
    expect(injects).toHaveLength(0); // NOT injected — target was busy

    // Target connects and drains its queue.
    const target = await connectClient(h.url, 'p1/sess-B');
    clients.push(target);
    const box = parseJson(
      await target.callTool({ name: 'agent_inbox', arguments: {} })
    ) as Array<{ from: string; body: string }>;
    expect(box).toHaveLength(1);
    expect(box[0]).toMatchObject({ from: 'reviewer', body: 'ping while busy' });

    // Drained: a second pull is empty.
    const box2 = parseJson(await target.callTool({ name: 'agent_inbox', arguments: {} }));
    expect(box2).toEqual([]);

    // Still never touched the user inbox.
    expect((await inbox.read()).entries).toHaveLength(0);
  });

  it('2b. pull-first safety: a live-but-not-idle target with a failed inject stays queued', async () => {
    // Target is reported idle (injectable) but the pty is NOT live, so the
    // inject returns false. The message must remain queued, never lost.
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'p1', cwd: '/b', handle: 'impl' });
    const injects: Array<{ sessionId: string; text: string }> = [];

    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1')],
      statusFor: () => 'idle', // claims injectable…
      injects,
      liveSessions: new Set(['sess-A']) // …but sess-B's pty is gone → inject fails
    });

    const sender = await connectClient(h.url, 'p1/sess-A');
    clients.push(sender);
    await sender.callTool({ name: 'agent_send', arguments: { to: 'impl', message: 'survive me' } });

    // Inject was attempted but returned false; message stays undelivered/queued.
    const pending = messageLog.pull('sess-B');
    expect(pending.map((m) => m.body)).toEqual(['survive me']);
    expect(pending[0].deliveredAt).toBeUndefined();
  });

  it('3. safe: cannot message yourself', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1')],
      statusFor: () => 'idle',
      injects: []
    });
    const client = await connectClient(h.url, 'p1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'agent_send',
      arguments: { to: 'reviewer', message: 'hi me' }
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    expect(JSON.stringify((res as { content?: unknown }).content)).toMatch(/yourself/);
  });

  it('3b. scope: cannot message a peer in another project without allProjects', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    registry.upsert({ sessionId: 'sess-X', projectId: 'p2', cwd: '/x', handle: 'stranger' });
    const injects: Array<{ sessionId: string; text: string }> = [];
    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1'), makeProject('p2', 'P2')],
      statusFor: () => 'idle',
      injects,
      liveSessions: new Set(['sess-A', 'sess-X'])
    });
    const client = await connectClient(h.url, 'p1/sess-A');
    clients.push(client);

    // Without allProjects → not found.
    const blocked = await client.callTool({
      name: 'agent_send',
      arguments: { to: 'stranger', message: 'cross-project' }
    });
    expect((blocked as { isError?: boolean }).isError).toBe(true);
    expect(injects).toHaveLength(0);

    // With allProjects → delivered.
    const ok = await client.callTool({
      name: 'agent_send',
      arguments: { to: 'stranger', message: 'cross-project', allProjects: true }
    });
    expect((ok as { isError?: boolean }).isError).toBeFalsy();
    expect(injects).toHaveLength(1);
    expect(injects[0].sessionId).toBe('sess-X');
  });

  it('4. safe: agent_send sender identity comes from the URL, not the args', async () => {
    const inbox = createMemoryInboxStore();
    const registry = createAgentRegistryStore();
    const messageLog = createAgentMessageLog();
    registry.upsert({ sessionId: 'sess-A', projectId: 'p1', cwd: '/a', handle: 'reviewer' });
    registry.upsert({ sessionId: 'sess-B', projectId: 'p1', cwd: '/b', handle: 'impl' });
    const h = await boot({
      inbox,
      registry,
      messageLog,
      projects: [makeProject('p1', 'P1')],
      statusFor: () => 'idle',
      injects: [],
      liveSessions: new Set(['sess-A', 'sess-B'])
    });
    const client = await connectClient(h.url, 'p1/sess-A');
    clients.push(client);
    await client.callTool({
      name: 'agent_send',
      // smuggle a fake sender — must be ignored
      arguments: { to: 'impl', message: 'x', fromSessionId: 'sess-EVIL', fromHandle: 'ghost' }
    });
    const hist = messageLog.history('p1');
    expect(hist[0].fromSessionId).toBe('sess-A');
    expect(hist[0].fromHandle).toBe('reviewer');
  });

  it('5. messaging tools are absent when the message log is not wired', async () => {
    // Registry present but no message log → discovery works, messaging doesn't.
    const registry = createAgentRegistryStore();
    handle = await startMcpServer({
      inboxStore: createMemoryInboxStore(),
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: () => makeProject('p1', 'P1') },
      agentRegistry: registry,
      getAgentStatus: () => 'idle',
      // agentMessageLog + injectToSession omitted
      log: () => {}
    });
    const client = await connectClient(handle.url, 'p1/sess-A');
    clients.push(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('list_agents'); // discovery present
    expect(names).not.toContain('agent_send'); // messaging absent
    expect(names).not.toContain('agent_inbox');
  });
});
