/**
 * End-to-end integration tests for the inbox MCP server.
 *
 * Unlike mcp-server.test.ts (which unit-tests the route matcher), these
 * boot the *real* http listener via startMcpServer() and drive it with a
 * genuine MCP client over StreamableHTTP — the same transport Claude's CLI
 * uses. We assert the full path: client.callTool('inbox_push') -> the entry
 * lands in the store with the projectId/sessionId taken from the URL, never
 * from anything the client supplies.
 *
 * Covers three concerns the user asked about:
 *   1. It works     — a real push round-trips and persists.
 *   2. It's safe    — projectId/sessionId come from the URL, not the agent;
 *                     a different project's server can't write your inbox.
 *   3. It recovers  — a tool error doesn't kill the server; a client
 *                     disconnect mid-stream doesn't leak or wedge it;
 *                     close() shuts the listener.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer, type McpServerHandle } from './mcp-server.js';
import { createMemoryInboxStore, type IInboxStore } from '@zana-ai/zcc-server';
import { createMemorySuggestionsStore } from '@zana-ai/zcc-server';
import { controlCredentialForSession } from '@zana-ai/zcc-host-daemon/control-credential';
import type { Project, PersonaSummary, ProjectSummary } from '@zana-ai/zcc-domain/product';

function makeProject(id: string, name: string): Project {
  return { id, name, path: `/tmp/${id}`, createdAt: 0, lastActiveAt: 0 };
}

/** Connect a real MCP client to `${baseUrl}/mcp/<path>`. */
async function connectClient(baseUrl: string, path: string): Promise<Client> {
  const client = new Client({ name: 'test-agent', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${path}`));
  await client.connect(transport);
  return client;
}

describe('inbox MCP server (end-to-end)', () => {
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

  async function boot(
    store: IInboxStore,
    projects: Project[],
    onReport?: (
      projectId: string,
      sessionId: string,
      summary: string,
      status?: 'success' | 'partial' | 'failure'
    ) => void,
    registerProject?: (absPath: string) =>
      | { project: Project; alreadyExisted: boolean }
      | Promise<{ project: Project; alreadyExisted: boolean }>,
    cloneProject?: (input: { url: string; name?: string }) => Promise<import('@zana-ai/zcc-domain/product').CloneProjectResult>,
    listPersonas?: () => PersonaSummary[],
    listProjects?: () => ProjectSummary[],
    resolveOrigin?: (sessionId: string) => import('@zana-ai/zcc-domain/product').InboxOrigin | null,
    runRemoteCommand?: (
      projectId: string,
      command: string,
      opts: { cwd?: string; timeoutMs?: number }
    ) => Promise<import('@zana-ai/zcc-domain/product').RemoteExecResult>
  ) {
    const map = new Map(projects.map((p) => [p.id, p]));
    handle = await startMcpServer({
      inboxStore: store,
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: (id) => map.get(id) ?? null },
      onReport,
      registerProject,
      cloneProject,
      listPersonas,
      listProjects,
      resolveOrigin,
      runRemoteCommand,
      log: () => {} // keep test output quiet
    });
    return handle;
  }

  it('1. works: a session-scoped inbox_push persists with the URL identity', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'My Project')]);

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // The tool schema exposes { docs, comments } plus the optional structured
    // question fields — but never projectId/sessionId (those come from the URL).
    const tools = await client.listTools();
    const push = tools.tools.find((t) => t.name === 'inbox_push');
    expect(push, 'inbox_push tool is registered').toBeTruthy();
    const props = (push!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      'allowOther',
      'blocking',
      'comments',
      'docs',
      'intent',
      'multiSelect',
      'options',
      'questions',
      'report',
      'subject'
    ]);
    // The identity fields are still absent from the agent-facing schema.
    expect(Object.keys(props)).not.toContain('projectId');
    expect(Object.keys(props)).not.toContain('sessionId');

    const res = await client.callTool({
      name: 'inbox_push',
      arguments: { comments: 'analysis complete' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].comments).toBe('analysis complete');
    expect(entries[0].projectId).toBe('proj-1');
    expect(entries[0].projectLabel).toBe('My Project');
    // The decisive assertion: sessionId came from the URL path.
    expect(entries[0].sessionId).toBe('sess-A');
  });

  it('forwards cancellation and route-identity guard through the request-scoped server builder', async () => {
    const project = makeProject('proj-1', 'My Project');
    const validateTeamRouteIdentity = vi.fn(() => true);
    const cancelTeamLaunch = vi.fn(() => ({
      ok: true as const,
      value: {
        canceledSessionIds: ['worker-1'],
        pendingSessionIds: [],
        lifecycleState: 'cancel-pending' as const
      }
    }));
    handle = await startMcpServer({
      inboxStore: createMemoryInboxStore(),
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: (id) => id === project.id ? project : null },
      launchTeam: vi.fn(() => ({
        ok: true as const,
        value: { launchRequestId: 'unused', launched: 0, cohortId: 'unused', workers: [], failedSlots: [] }
      })),
      cancelTeamLaunch,
      validateTeamRouteIdentity,
      log: () => {}
    });
    const credential = controlCredentialForSession('caller-session');
    const client = await connectClient(handle.url, `proj-1/caller-session/${credential}`);
    clients.push(client);

    const canceled = await client.callTool({
      name: 'cancel_team_launch', arguments: { launchRequestId: 'request-1' }
    });
    expect((canceled as { isError?: boolean }).isError).toBeFalsy();
    expect(validateTeamRouteIdentity).toHaveBeenCalledWith('caller-session', 'proj-1');
    expect(cancelTeamLaunch).toHaveBeenCalledWith('caller-session', 'request-1');

    validateTeamRouteIdentity.mockReturnValue(false);
    const rejected = await client.callTool({
      name: 'cancel_team_launch', arguments: { launchRequestId: 'request-2' }
    });
    expect((rejected as { isError?: boolean }).isError).toBe(true);
    expect(cancelTeamLaunch).not.toHaveBeenCalledWith('caller-session', 'request-2');
  });

  it('rejects Team mutations on a forged or uncredentialed live session route', async () => {
    const project = makeProject('proj-1', 'My Project');
    const cancelTeamLaunch = vi.fn(() => ({
      ok: true as const,
      value: { canceledSessionIds: [], pendingSessionIds: [], lifecycleState: 'canceled' as const }
    }));
    handle = await startMcpServer({
      inboxStore: createMemoryInboxStore(), suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: () => project },
      launchTeam: vi.fn(() => ({ ok: true as const, value: { launchRequestId: 'x', launched: 0, cohortId: 'x', workers: [], failedSlots: [] } })),
      cancelTeamLaunch, validateTeamRouteIdentity: () => true, log: () => {}
    });
    for (const path of ['proj-1/caller-session', 'proj-1/caller-session/forged']) {
      const client = await connectClient(handle.url, path);
      clients.push(client);
      const result = await client.callTool({ name: 'cancel_team_launch', arguments: { launchRequestId: 'request-1' } });
      expect((result as { isError?: boolean }).isError).toBe(true);
    }
    expect(cancelTeamLaunch).not.toHaveBeenCalled();
  });

  it('1a2. stamps host-resolved origin (resume coordinates) onto a session-scoped push', async () => {
    const store = createMemoryInboxStore();
    const origins: Record<string, import('@zana-ai/zcc-domain/product').InboxOrigin> = {
      'sess-A': {
        claudeSessionId: '11111111-1111-4111-8111-111111111111',
        profile: 'claude',
        personaId: 'reviewer',
        cwd: '/work/p1/sub'
      }
    };
    const h = await boot(
      store,
      [makeProject('proj-1', 'My Project')],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      (sessionId) => origins[sessionId] ?? null
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    await client.callTool({ name: 'inbox_push', arguments: { comments: 'done' } });

    const { entries } = await store.read();
    expect(entries[0].origin).toEqual(origins['sess-A']);
  });

  it('1a3. omits origin on the legacy project-scoped route (no originating session)', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(
      store,
      [makeProject('proj-1', 'My Project')],
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => ({ claudeSessionId: '11111111-1111-4111-8111-111111111111' })
    );

    const client = await connectClient(h.url, 'proj-1');
    clients.push(client);
    await client.callTool({ name: 'inbox_push', arguments: { comments: 'legacy' } });

    const { entries } = await store.read();
    // resolveOrigin is only consulted on the session-scoped route.
    expect(entries[0].origin).toBeUndefined();
  });

  it('1b. works: the legacy project-scoped route persists with no sessionId', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'My Project')]);

    const client = await connectClient(h.url, 'proj-1');
    clients.push(client);
    await client.callTool({ name: 'inbox_push', arguments: { comments: 'legacy push' } });

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].projectId).toBe('proj-1');
    expect(entries[0].sessionId).toBeUndefined();
  });

  it('1c. inbox_ask: session-scoped structured question persists prompt + host-lettered options', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'My Project')]);

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // Schema exposes the question form, never projectId/sessionId/option-ids.
    const tools = await client.listTools();
    const ask = tools.tools.find((t) => t.name === 'inbox_ask');
    expect(ask, 'inbox_ask tool is registered on the session route').toBeTruthy();
    const props = (ask!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual([
      'allowOther',
      'intent',
      'multiSelect',
      'options',
      'preamble',
      'question',
      'questions',
      'subject'
    ]);

    const res = await client.callTool({
      name: 'inbox_ask',
      arguments: {
        question: 'Which approach?',
        options: ['Rewrite', 'Patch in place'],
        allowOther: true
      }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    // Prompt lives in comments; options carry host-assigned A/B letters.
    expect(entries[0].comments).toBe('Which approach?');
    expect(entries[0].sessionId).toBe('sess-A');
    expect(entries[0].question?.options).toEqual([
      { id: 'A', label: 'Rewrite' },
      { id: 'B', label: 'Patch in place' }
    ]);
    expect(entries[0].question?.allowOther).toBe(true);
  });

  it('1d. inbox_ask is NOT registered on the legacy project-only route (no session to answer to)', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'My Project')]);

    const client = await connectClient(h.url, 'proj-1');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.some((t) => t.name === 'inbox_ask')).toBe(false);
  });

  it('2. safe: the agent cannot forge projectId/sessionId — only the URL counts', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1'), makeProject('proj-2', 'P2')]);

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // Try to smuggle a different project/session through the arguments.
    await client.callTool({
      name: 'inbox_push',
      arguments: {
        comments: 'forgery attempt',
        // These are NOT in the schema; sent raw on the wire.
        projectId: 'proj-2',
        sessionId: 'sess-EVIL'
      }
    });

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    // URL wins; the smuggled values are ignored entirely. This is
    // defense-in-depth: the SDK's zod schema strips the unknown
    // projectId/sessionId keys before the handler runs, AND the handler
    // closes over the URL identity rather than reading from args. Either
    // layer alone blocks the forgery; both are present.
    expect(entries[0].projectId).toBe('proj-1');
    expect(entries[0].sessionId).toBe('sess-A');
    expect(entries[0].comments).toBe('forgery attempt'); // the legit field still landed
  });

  it('2b. safe: an unknown project still keys the URL projectId (renderer tombstones it)', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, []); // no projects registered

    const client = await connectClient(h.url, 'ghost-proj/sess-X');
    clients.push(client);
    await client.callTool({ name: 'inbox_push', arguments: { comments: 'orphan' } });

    const { entries } = await store.read();
    expect(entries).toHaveLength(1);
    expect(entries[0].projectId).toBe('ghost-proj');
    expect(entries[0].projectLabel).toBeUndefined(); // no live label to snapshot
    expect(entries[0].sessionId).toBe('sess-X');
  });

  it('3. recovers: a tool-level error is reported but does NOT kill the server', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);

    // First call: invalid input (neither docs nor comments) -> store throws,
    // tool returns isError, server stays up.
    const c1 = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(c1);
    const bad = await c1.callTool({ name: 'inbox_push', arguments: {} });
    expect((bad as { isError?: boolean }).isError).toBe(true);
    const errText = JSON.stringify((bad as { content?: unknown }).content ?? '');
    expect(errText).toMatch(/at least one of docs, comments, or question/);

    // Second call on a FRESH connection: the listener survived the error
    // and still serves a valid push.
    const c2 = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(c2);
    const ok = await c2.callTool({ name: 'inbox_push', arguments: { comments: 'after error' } });
    expect((ok as { isError?: boolean }).isError).toBeFalsy();

    const { entries } = await store.read();
    expect(entries).toHaveLength(1); // only the valid one persisted
    expect(entries[0].comments).toBe('after error');
  });

  it('3b. recovers: an abrupt client close mid-session does not wedge the server', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1'), makeProject('proj-2', 'P2')]);

    // Open, push, then hard-close the transport (simulates the agent's tab
    // being killed). The per-request cleanup should fire without throwing.
    const c1 = await connectClient(h.url, 'proj-1/sess-A');
    await c1.callTool({ name: 'inbox_push', arguments: { comments: 'first' } });
    await c1.close(); // abrupt teardown

    // A brand-new client connects and works — proves no leaked state pins
    // the listener or the projectId identity from the previous connection.
    const c2 = await connectClient(h.url, 'proj-2/sess-B');
    clients.push(c2);
    await c2.callTool({ name: 'inbox_push', arguments: { comments: 'second' } });

    const { entries } = await store.read();
    expect(entries.map((e) => e.comments).sort()).toEqual(['first', 'second']);
    const second = entries.find((e) => e.comments === 'second')!;
    expect(second.projectId).toBe('proj-2'); // NOT proj-1 — no identity bleed
    expect(second.sessionId).toBe('sess-B');
  });

  it('3c. recovers: close() shuts the listener so the port stops accepting', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);
    const url = h.url;

    const c1 = await connectClient(url, 'proj-1/sess-A');
    await c1.callTool({ name: 'inbox_push', arguments: { comments: 'before close' } });
    await c1.close();

    await h.close();
    handle = null; // afterEach must not double-close

    // A fresh connection to the now-closed port must fail to connect.
    await expect(connectClient(url, 'proj-1/sess-A')).rejects.toThrow();
  });

  it('4. schedule_report: fires onReport with the URL sessionId, schema hides ids', async () => {
    const store = createMemoryInboxStore();
    const calls: Array<{ projectId: string; sessionId: string; summary: string; status?: string }> = [];
    const h = await boot(store, [makeProject('proj-1', 'P1')], (projectId, sessionId, summary, status) =>
      calls.push({ projectId, sessionId, summary, status })
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // The tool schema only exposes { summary, status } — no projectId/sessionId.
    const tools = await client.listTools();
    const report = tools.tools.find((t) => t.name === 'schedule_report');
    expect(report, 'schedule_report tool is registered').toBeTruthy();
    const props = (report!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['status', 'summary']);

    const res = await client.callTool({
      name: 'schedule_report',
      arguments: { summary: 'did the thing', status: 'success' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();

    expect(calls).toHaveLength(1);
    expect(calls[0].summary).toBe('did the thing');
    expect(calls[0].status).toBe('success');
    // Decisive: identity comes from the URL, not the agent.
    expect(calls[0].projectId).toBe('proj-1');
    expect(calls[0].sessionId).toBe('sess-A');
  });

  it('4b. schedule_report is NOT registered on the legacy project-scoped route', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')], () => {});

    // No sessionId in the URL → nothing to attach to, so the tool isn't
    // offered at all (rather than offered-but-always-failing).
    const client = await connectClient(h.url, 'proj-1');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'schedule_report')).toBeFalsy();
    // inbox_push is still available on this route.
    expect(tools.tools.find((t) => t.name === 'inbox_push')).toBeTruthy();
  });

  it('5. register_project: resolves a relative path against the URL project root', async () => {
    const store = createMemoryInboxStore();
    const calls: string[] = [];
    const added = makeProject('new-1', 'cloned-repo');
    const h = await boot(
      store,
      [{ ...makeProject('proj-1', 'P1'), path: '/work/p1' }],
      undefined,
      (absPath) => {
        calls.push(absPath);
        return { project: added, alreadyExisted: false };
      }
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    // Schema exposes only { path } — no projectId/sessionId.
    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'register_project');
    expect(tool, 'register_project tool is registered').toBeTruthy();
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual(['path']);

    const res = await client.callTool({
      name: 'register_project',
      arguments: { path: 'cloned-repo' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    // Relative path resolved against the originating project's root (/work/p1).
    expect(calls).toEqual(['/work/p1/cloned-repo']);
    const text = JSON.stringify((res as { content?: unknown }).content ?? '');
    expect(text).toMatch(/Registered project/);
    expect(text).toMatch(/cloned-repo/);
  });

  it('5b. register_project: passes an absolute path through unchanged', async () => {
    const store = createMemoryInboxStore();
    const calls: string[] = [];
    const h = await boot(
      store,
      [{ ...makeProject('proj-1', 'P1'), path: '/work/p1' }],
      undefined,
      (absPath) => {
        calls.push(absPath);
        return { project: makeProject('new-2', 'abs'), alreadyExisted: true };
      }
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'register_project',
      arguments: { path: '/elsewhere/repo' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    expect(calls).toEqual(['/elsewhere/repo']);
    // alreadyExisted → honest wording.
    const text = JSON.stringify((res as { content?: unknown }).content ?? '');
    expect(text).toMatch(/Already registered/);
  });

  it('5bb. register_project awaits an asynchronous registration authority', async () => {
    const store = createMemoryInboxStore();
    const registerProject = vi.fn(async (absPath: string) => ({
      project: makeProject('new-async', 'async-project'),
      alreadyExisted: absPath === '/work/p1/async-project'
    }));
    const h = await boot(
      store,
      [{ ...makeProject('proj-1', 'P1'), path: '/work/p1' }],
      undefined,
      registerProject
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'register_project',
      arguments: { path: 'async-project' }
    });

    expect((res as { isError?: boolean }).isError).toBeFalsy();
    expect(registerProject).toHaveBeenCalledWith('/work/p1/async-project');
    expect(JSON.stringify((res as { content?: unknown }).content ?? '')).toMatch(/Already registered/);
  });

  it('5c. register_project: reports an error (does not crash) when the add throws', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(
      store,
      [{ ...makeProject('proj-1', 'P1'), path: '/work/p1' }],
      undefined,
      () => {
        throw new Error('not a directory');
      }
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'register_project',
      arguments: { path: 'nope' }
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const text = JSON.stringify((res as { content?: unknown }).content ?? '');
    expect(text).toMatch(/register_project failed: not a directory/);
  });

  it('5d. register_project is NOT registered when no registerProject dep is provided', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'register_project')).toBeFalsy();
  });

  it('5e. clone_project requires a credential-authenticated session route', async () => {
    const store = createMemoryInboxStore();
    const cloneProject = vi.fn(async () => ({ ok: true as const, project: makeProject('new-3', 'repo') }));
    const h = await boot(store, [makeProject('proj-1', 'P1')], undefined, undefined, cloneProject);

    const unauthenticated = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(unauthenticated);
    expect((await unauthenticated.listTools()).tools.some((t) => t.name === 'clone_project')).toBe(false);

    const credential = controlCredentialForSession('sess-A');
    const authenticated = await connectClient(h.url, `proj-1/sess-A/${credential}`);
    clients.push(authenticated);
    const tool = (await authenticated.listTools()).tools.find((t) => t.name === 'clone_project');
    expect(tool).toBeTruthy();

    const result = await authenticated.callTool({ name: 'clone_project', arguments: { url: 'salesforce/repo' } });
    expect((result as { isError?: boolean }).isError).toBeFalsy();
    expect(cloneProject).toHaveBeenCalledWith({ url: 'salesforce/repo', name: undefined });
  });

  it('6. list_personas: returns metadata-only summaries, takes no args', async () => {
    const store = createMemoryInboxStore();
    const personas: PersonaSummary[] = [
      {
        id: 'builtin:reviewer',
        name: 'Code Reviewer',
        description: 'Reviews diffs',
        baseProfile: 'claude',
        model: 'opus'
      }
    ];
    const h = await boot(store, [makeProject('proj-1', 'P1')], undefined, undefined, undefined, () => personas);

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'list_personas');
    expect(tool, 'list_personas tool is registered').toBeTruthy();
    // No arguments.
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual([]);

    const res = await client.callTool({ name: 'list_personas', arguments: {} });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const text = (res as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '[]';
    const parsed = JSON.parse(text) as PersonaSummary[];
    expect(parsed).toEqual(personas);
    // The sensitive system-prompt body is never exposed.
    expect(text).not.toMatch(/appendSystemPrompt/);
  });

  it('6b. list_personas is available on the legacy project-scoped route too', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')], undefined, undefined, undefined, () => [
      { id: 'builtin:architect', name: 'Architect' }
    ]);
    const client = await connectClient(h.url, 'proj-1'); // no sessionId
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'list_personas')).toBeTruthy();
  });

  it('6c. list_personas is NOT registered when no listPersonas dep is provided', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'list_personas')).toBeFalsy();
  });

  it('7. list_projects: returns metadata-only summaries, takes no args', async () => {
    const store = createMemoryInboxStore();
    const summaries: ProjectSummary[] = [
      { id: 'proj-1', name: 'Local Project', path: '/tmp/proj-1', tag: 'local' },
      {
        id: 'proj-2',
        name: 'Devbox',
        path: '/srv/app',
        tag: 'devbox',
        remote: { host: 'my-devbox', user: 'me' }
      }
    ];
    const h = await boot(
      store,
      [makeProject('proj-1', 'P1')],
      undefined,
      undefined,
      undefined,
      undefined,
      () => summaries
    );

    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'list_projects');
    expect(tool, 'list_projects tool is registered').toBeTruthy();
    // No arguments.
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props)).toEqual([]);

    const res = await client.callTool({ name: 'list_projects', arguments: {} });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const text = (res as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '[]';
    const parsed = JSON.parse(text) as ProjectSummary[];
    expect(parsed).toEqual(summaries);
    // The remote project is distinguishable from the local one.
    expect(parsed[1].remote?.host).toBe('my-devbox');
  });

  it('7b. list_projects is available on the legacy project-scoped route too', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')], undefined, undefined, undefined, undefined, () => [
      { id: 'proj-1', name: 'P1', path: '/tmp/proj-1' }
    ]);
    const client = await connectClient(h.url, 'proj-1'); // no sessionId
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'list_projects')).toBeTruthy();
  });

  it('7c. list_projects is NOT registered when no listProjects dep is provided', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'list_projects')).toBeFalsy();
  });

  // remote_exec over the REAL MCP transport. runRemoteCommand is mocked (the
  // ssh round-trip is covered by remote-fs.test.ts); here we prove the tool is
  // wired, its schema is agent-facing (projectId/command/cwd/timeoutMs, no
  // identity leak), args round-trip to the impl, and ok/!ok map correctly.
  const bootExec = (
    store: IInboxStore,
    run: (
      projectId: string,
      command: string,
      opts: { cwd?: string; timeoutMs?: number }
    ) => Promise<import('@zana-ai/zcc-domain/product').RemoteExecResult>
  ) =>
    boot(store, [makeProject('proj-1', 'P1')], undefined, undefined, undefined, undefined, undefined, undefined, run);

  it('8. remote_exec: registered on the session route with an agent-facing schema', async () => {
    const store = createMemoryInboxStore();
    const h = await bootExec(store, async () => ({ ok: true, code: 0, stdout: '', stderr: '', truncated: false }));
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'remote_exec');
    expect(tool, 'remote_exec is registered').toBeTruthy();
    const props = (tool!.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(props).sort()).toEqual(['command', 'cwd', 'projectId', 'timeoutMs']);
  });

  it('8b. remote_exec: registered on the legacy project-scoped route too', async () => {
    const store = createMemoryInboxStore();
    const h = await bootExec(store, async () => ({ ok: true, code: 0 }));
    const client = await connectClient(h.url, 'proj-1'); // no sessionId
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'remote_exec')).toBeTruthy();
  });

  it('8c. remote_exec: NOT registered when no runRemoteCommand dep is provided', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'P1')]);
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'remote_exec')).toBeFalsy();
  });

  it('8d. remote_exec: args round-trip to the impl and a success maps to the JSON payload', async () => {
    const store = createMemoryInboxStore();
    const calls: Array<{ projectId: string; command: string; opts: unknown }> = [];
    const h = await bootExec(store, async (projectId, command, opts) => {
      calls.push({ projectId, command, opts });
      return { ok: true, code: 0, stdout: 'ok-out', stderr: '', truncated: false };
    });
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);

    const res = await client.callTool({
      name: 'remote_exec',
      arguments: { projectId: 'remote-42', command: 'git status', cwd: 'services/api', timeoutMs: 5000 }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      projectId: 'remote-42',
      command: 'git status',
      opts: { cwd: 'services/api', timeoutMs: 5000 }
    });
    const text = (res as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}';
    expect(JSON.parse(text)).toEqual({
      projectId: 'remote-42',
      exitCode: 0,
      stdout: 'ok-out',
      stderr: '',
      truncated: false
    });
  });

  it('8e. remote_exec: a non-zero exit is DATA (not isError)', async () => {
    const store = createMemoryInboxStore();
    const h = await bootExec(store, async () => ({ ok: true, code: 2, stdout: '', stderr: 'boom', truncated: false }));
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'remote_exec',
      arguments: { projectId: 'remote-42', command: 'false' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    const text = (res as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    expect(parsed.exitCode).toBe(2);
    expect(parsed.stderr).toBe('boom');
  });

  it('8f. remote_exec: a transport failure (non-remote / unreachable) surfaces as isError', async () => {
    const store = createMemoryInboxStore();
    const h = await bootExec(store, async () => ({ ok: false, message: 'Not a remote project' }));
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'remote_exec',
      arguments: { projectId: 'a-local-project', command: 'ls' }
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const text = JSON.stringify((res as { content?: unknown }).content ?? '');
    expect(text).toMatch(/Not a remote project/);
  });

  it('8g. remote_exec: identity is NOT smuggled — the agent passes projectId explicitly', async () => {
    // Unlike inbox_push, remote_exec's projectId IS an agent-supplied argument
    // (it targets an OTHER project by id). The trust boundary is main's
    // store-resolution (tested in remote-fs.test.ts), not the URL. Here we just
    // confirm the id the agent sends is the id the impl receives verbatim.
    const store = createMemoryInboxStore();
    let seen = '';
    const h = await bootExec(store, async (projectId) => {
      seen = projectId;
      return { ok: true, code: 0 };
    });
    const client = await connectClient(h.url, 'proj-1/sess-A'); // URL project is proj-1
    clients.push(client);
    await client.callTool({
      name: 'remote_exec',
      arguments: { projectId: 'some-other-remote', command: 'ls' }
    });
    // The agent-supplied target id reaches the impl (which re-authorizes it against the store).
    expect(seen).toBe('some-other-remote');
  });

  it('9. remote_read: closes over the URL projectId and is absent without remoteFs', async () => {
    const store = createMemoryInboxStore();
    const seen: string[] = [];
    handle = await startMcpServer({
      inboxStore: store,
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: () => makeProject('proj-1', 'P1') },
      remoteFs: {
        readFile: async (projectId, path) => {
          seen.push(`${projectId}:${path}`);
          return { ok: true, content: 'from-remote', bytes: 11, binary: false };
        },
        writeFile: async () => ({ ok: true, bytes: 0 }),
        listDir: async () => ({ ok: true, entries: [] }),
        glob: async () => ({ ok: true, files: [] }),
        grep: async () => ({ ok: true, output: '', truncated: false })
      },
      log: () => {}
    });
    const client = await connectClient(handle.url, 'proj-1/sess-A');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'remote_read')).toBeTruthy();
    expect(tools.tools.find((t) => t.name === 'remote_exec')).toBeFalsy();
    const res = await client.callTool({
      name: 'remote_read',
      arguments: { path: 'README.md', projectId: 'forged' }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    expect(seen).toEqual(['proj-1:README.md']);
    const text = (res as { content?: Array<{ text?: string }> }).content?.[0]?.text;
    expect(text).toBe('from-remote');

    await client.close();
    clients.pop();
    await handle.close();
    handle = null;

    const bare = await boot(store, [makeProject('proj-1', 'P1')]);
    const other = await connectClient(bare.url, 'proj-1/sess-A');
    clients.push(other);
    const listed = await other.listTools();
    expect(listed.tools.find((t) => t.name === 'remote_read')).toBeFalsy();
  });

  it('registers browser automation tools that fail closed without a desktop host', async () => {
    const store = createMemoryInboxStore();
    const h = await boot(store, [makeProject('proj-1', 'My Project')]);
    const client = await connectClient(h.url, 'proj-1/sess-A');
    clients.push(client);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name === 'browser_open'), 'browser_open tool is registered').toBeTruthy();
    expect(tools.tools.find((t) => t.name === 'preview_file'), 'preview_file tool is registered').toBeTruthy();
    const previewSchema = tools.tools.find((t) => t.name === 'preview_file')!;
    const previewProps = (previewSchema.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
    expect(Object.keys(previewProps)).not.toContain('threadId');
    expect(Object.keys(previewProps)).not.toContain('projectId');
    const res = await client.callTool({
      name: 'browser_open',
      arguments: { url: 'https://example.com' }
    });
    expect((res as { isError?: boolean }).isError).toBe(true);
    const text = (res as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
    expect(text).toContain('desktop app');
    const preview = await client.callTool({
      name: 'preview_file',
      arguments: { path: 'src/a.ts' }
    });
    expect((preview as { isError?: boolean }).isError).toBe(true);
    const previewText = (preview as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
    expect(previewText).toContain('desktop app');
  });

  it('preview_file closes over the session URL and ignores a forged threadId', async () => {
    const store = createMemoryInboxStore();
    const seen: unknown[] = [];
    handle = await startMcpServer({
      inboxStore: store,
      suggestionsStore: createMemorySuggestionsStore(),
      projects: { get: (id) => (id === 'proj-1' ? makeProject('proj-1', 'My Project') : null) },
      previewFile: async (input) => {
        seen.push(input);
        return { delivered: 1, path: input.path, source: input.source };
      },
      log: () => {}
    });
    const client = await connectClient(handle.url, 'proj-1/sess-A');
    clients.push(client);
    const res = await client.callTool({
      name: 'preview_file',
      arguments: { path: 'src/a.ts', threadId: 'other-thread', lineNumber: 3 }
    });
    expect((res as { isError?: boolean }).isError).toBeFalsy();
    expect(seen).toEqual([{
      threadId: 'sess-A',
      projectId: 'proj-1',
      source: 'workspace',
      path: 'src/a.ts',
      lineNumber: 3
    }]);

    const projectOnly = await connectClient(handle.url, 'proj-1');
    clients.push(projectOnly);
    const listed = await projectOnly.listTools();
    expect(listed.tools.find((t) => t.name === 'preview_file')).toBeFalsy();
  });
});
