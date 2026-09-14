import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ControlError, exitCodeForControlError } from './errors.js';
import { ProductHttpClient, probeHealth } from './http.js';
import { resolveConnect } from './connect.js';
import { Zcc } from './client.js';
import { spawnThread } from './threads.js';
import { assertRoleXorModel, launchCliAgent, rejectIsolatedCliAgent } from './cli-agents.js';
import { waitForThreadEvent, waitForThreadStatus, threadIsQuiet } from './wait.js';
import { ensureLiveSandbox } from './projects.js';
import { health, preflight } from './harness.js';
import { cleanupRun, cleanupStale } from './cleanup.js';
import { appendJournalIds, createRunId, liveTitle, listJournals, readJournal, titleMatchesRun, writeJournal } from './tags.js';
import { liveEnabled, preflightOrSkip, isSkip } from './matrix.js';
import {
  assertLoopbackWs,
  DesktopBrowserHandle,
  importSourcesLeakCookieMaterial,
  jpegMagicOk,
  parseDesktopBrowserImportOutcome,
  pickDesktopBrowserInstance,
  planDesktopBrowserImportProbe,
  probeLoopbackCdpVersion,
  runDesktopBrowserImportProbe,
  runDesktopBrowserLeaseCycle
} from './browsers.js';

interface Route {
  method: string;
  path: string;
  status?: number;
  body?: unknown;
  handler?: (url: URL, reqBody: unknown) => { status?: number; body: unknown };
}

function listen(routes: Route[]): Promise<{ url: string; server: Server; calls: Array<{ method: string; path: string; body: unknown }> }> {
  const calls: Array<{ method: string; path: string; body: unknown }> = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk as Buffer));
    req.on('end', () => {
      let parsed: unknown = null;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }
      }
      const method = (req.method ?? 'GET').toUpperCase();
      calls.push({ method, path: url.pathname, body: parsed });
      const route = routes.find((entry) => entry.method === method && entry.path === url.pathname);
      if (!route) {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `unmocked ${method} ${url.pathname}` }));
        return;
      }
      const result = route.handler
        ? route.handler(url, parsed)
        : { status: route.status, body: route.body };
      res.writeHead(result.status ?? route.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result.body ?? null));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server, calls });
    });
  });
}

const servers: Server[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.ZCC_SESSION_ID;
  delete process.env.ZCC_SERVER_URL;
});

async function boot(routes: Route[]) {
  const started = await listen(routes);
  servers.push(started.server);
  return started;
}

function tmpData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'zcc-control-'));
  dirs.push(dir);
  return dir;
}

describe('ProductHttpClient', () => {
  it('maps health and JSON errors', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      { method: 'GET', path: '/api/v1/missing', status: 404, body: { error: 'gone', message: 'nope' } },
      { method: 'POST', path: '/api/v1/denied', status: 403, body: { code: 'FORBIDDEN_AGENT', message: 'agent' } }
    ]);
    expect(await probeHealth(url)).toBe(true);
    const http = new ProductHttpClient(url);
    await expect(http.request('GET', '/api/v1/missing')).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    await expect(http.request('POST', '/api/v1/denied', { body: {} })).rejects.toMatchObject({
      code: 'FORBIDDEN_AGENT'
    });
  });

  it('maps connection failures to APP_NOT_RUNNING', async () => {
    const http = new ProductHttpClient('http://127.0.0.1:1');
    await expect(http.request('GET', '/api/v1/health')).rejects.toMatchObject({ code: 'APP_NOT_RUNNING' });
  });
});

describe('resolveConnect', () => {
  it('uses an explicit healthy URL', async () => {
    const { url } = await boot([{ method: 'GET', path: '/api/v1/health', body: { ok: true } }]);
    const resolved = await resolveConnect({ serverUrl: url, dataDir: tmpData() });
    expect(resolved.serverUrl).toBe(url);
    expect(resolved.isolated).toBe(false);
  });

  it('throws FAKE_ATTACH for provider fake', async () => {
    await expect(resolveConnect({ provider: 'fake' })).rejects.toMatchObject({ code: 'FAKE_ATTACH' });
  });

  it('throws FORBIDDEN_AGENT when ZCC_SESSION_ID is set', async () => {
    process.env.ZCC_SESSION_ID = 'sess-1';
    await expect(resolveConnect({ serverUrl: 'http://127.0.0.1:8780' })).rejects.toMatchObject({
      code: 'FORBIDDEN_AGENT'
    });
  });

  it('throws APP_NOT_RUNNING when the explicit URL is down', async () => {
    await expect(resolveConnect({ serverUrl: 'http://127.0.0.1:1' })).rejects.toMatchObject({
      code: 'APP_NOT_RUNNING'
    });
  });
});

describe('threads and wait', () => {
  it('spawns hidden tagged threads and waits until idle', async () => {
    const dataDir = tmpData();
    let status = 'active';
    const { url, calls } = await boot([
      {
        method: 'POST',
        path: '/api/v1/threads',
        handler: (_url, body) => {
          expect(body).toMatchObject({
            projectId: 'p1',
            visibility: 'hidden',
            origin: 'sdk',
            acpMode: 'build'
          });
          expect(String((body as { title: string }).title)).toContain('[zcc-live:');
          return { status: 201, body: { thread: { id: 'thr-1', status: 'starting', projectId: 'p1' } } };
        }
      },
      { method: 'GET', path: '/api/v1/threads/thr-1', handler: () => ({ body: { thread: { id: 'thr-1', status, projectId: 'p1' } } }) },
      { method: 'GET', path: '/api/v1/threads/thr-1/interactions', body: { interactions: [] } }
    ]);
    const http = new ProductHttpClient(url);
    const handle = await spawnThread(http, {
      projectId: 'p1',
      prompt: 'ping',
      acpMode: 'build'
    }, { runId: 'run1', dataDir });
    expect(handle.id).toBe('thr-1');
    expect(readJournal(dataDir, 'run1')?.threadIds).toEqual(['thr-1']);
    status = 'idle';
    const waited = await handle.wait({ until: 'idle', timeoutMs: 2_000 });
    expect(waited.status).toBe('idle');
    expect(calls.some((call) => call.path === '/api/v1/threads')).toBe(true);
  });

  it('spawns an untagged operator thread without a live title or journal', async () => {
    const dataDir = tmpData();
    const { url } = await boot([
      {
        method: 'POST',
        path: '/api/v1/threads',
        handler: (_url, body) => {
          expect(body).toMatchObject({
            projectId: 'p1',
            visibility: 'visible',
            origin: 'sdk',
            title: 'Review'
          });
          expect(String((body as { title: string }).title)).not.toContain('[zcc-live:');
          return { status: 201, body: { thread: { id: 'thr-op', status: 'starting', projectId: 'p1' } } };
        }
      }
    ]);
    const handle = await spawnThread(new ProductHttpClient(url), {
      projectId: 'p1',
      prompt: 'ping',
      title: 'Review'
    }, { runId: 'run1', dataDir, tagged: false });
    expect(handle.id).toBe('thr-op');
    expect(readJournal(dataDir, 'run1')).toBeNull();
  });

  it('fails fast on a pending interaction by default', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/threads/thr-1', body: { thread: { id: 'thr-1', status: 'waiting' } } },
      { method: 'GET', path: '/api/v1/threads/thr-1/interactions', body: { interactions: [{ id: 'i1', prompt: 'Allow bash?' }] } },
      { method: 'GET', path: '/api/v1/threads/thr-1/events', body: { events: [] } },
      { method: 'GET', path: '/api/v1/health', body: { ok: true } }
    ]);
    const http = new ProductHttpClient(url);
    await expect(waitForThreadStatus(http, 'thr-1', { until: 'idle', timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'INTERACTION'
    });
  });

  it('fails wait when the thread enters error', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/threads/thr-1', body: { thread: { id: 'thr-1', status: 'error' } } },
      { method: 'GET', path: '/api/v1/threads/thr-1/interactions', body: { interactions: [] } },
      { method: 'GET', path: '/api/v1/threads/thr-1/events', body: { events: [] } },
      { method: 'GET', path: '/api/v1/health', body: { ok: true } }
    ]);
    const http = new ProductHttpClient(url);
    await expect(waitForThreadStatus(http, 'thr-1', { until: 'idle', timeoutMs: 1_000 })).rejects.toMatchObject({
      code: 'UNHEALTHY'
    });
  });

  it('denies pending interactions when asked', async () => {
    let resolved = false;
    let status = 'waiting';
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/threads/thr-1', handler: () => ({ body: { thread: { id: 'thr-1', status } } }) },
      {
        method: 'GET',
        path: '/api/v1/threads/thr-1/interactions',
        handler: () => ({ body: { interactions: resolved ? [] : [{ id: 'i1', prompt: 'Allow bash?' }] } })
      },
      {
        method: 'POST',
        path: '/api/v1/threads/thr-1/interactions/i1/resolve',
        handler: (_url, body) => {
          expect(body).toMatchObject({ decision: 'deny' });
          resolved = true;
          status = 'idle';
          return { body: { ok: true } };
        }
      }
    ]);
    const http = new ProductHttpClient(url);
    const row = await waitForThreadStatus(http, 'thr-1', {
      until: 'idle',
      timeoutMs: 2_000,
      onInteraction: 'deny'
    });
    expect(row.status).toBe('idle');
    expect(resolved).toBe(true);
  });

  it('retries a transient 500 while waiting for idle', async () => {
    let polls = 0;
    const { url } = await boot([
      {
        method: 'GET',
        path: '/api/v1/threads/thr-1',
        handler: () => {
          polls += 1;
          if (polls === 1) return { status: 500, body: { message: 'transient' } };
          return { body: { thread: { id: 'thr-1', status: 'idle' } } };
        }
      },
      { method: 'GET', path: '/api/v1/threads/thr-1/interactions', body: { interactions: [] } }
    ]);
    const http = new ProductHttpClient(url);
    const row = await waitForThreadStatus(http, 'thr-1', { until: 'idle', timeoutMs: 2_000 });
    expect(row.status).toBe('idle');
    expect(polls).toBeGreaterThan(1);
  });

  it('waits for a typed thread event', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/threads/thr-1/events/wait', body: { type: 'turn/completed', threadId: 'thr-1' } }
    ]);
    const http = new ProductHttpClient(url);
    await expect(waitForThreadEvent(http, 'thr-1', { type: 'turn/completed' })).resolves.toMatchObject({
      type: 'turn/completed'
    });
  });
});

describe('cli agents', () => {
  it('encodes native role XOR catalog model', () => {
    expect(() => assertRoleXorModel({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { roleTargetId: 'build', modelTargetId: 'gpt' } }
      }
    })).toThrow(ControlError);
    expect(() => assertRoleXorModel({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { roleTargetId: 'build', modelLevel: 'high' } }
      }
    })).toThrow(ControlError);
    expect(() => assertRoleXorModel({
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: { opencode: { roleTargetId: 'build' } }
      }
    })).not.toThrow();
  });

  it('rejects isolated CLI Agent', () => {
    expect(() => rejectIsolatedCliAgent(true)).toThrowError(/harness.start/);
    expect(() => rejectIsolatedCliAgent(false)).not.toThrow();
  });

  it('launches via /api/v1/cli-agents', async () => {
    const dataDir = tmpData();
    const { url } = await boot([
      {
        method: 'POST',
        path: '/api/v1/cli-agents',
        handler: (_url, body) => {
          expect(body).toMatchObject({ projectId: 'p1', profile: 'claude', prompt: 'hi' });
          return { status: 201, body: { session: { id: 's1', projectId: 'p1', profile: 'claude', status: 'working' } } };
        }
      }
    ]);
    const agent = await launchCliAgent(new ProductHttpClient(url), {
      projectId: 'p1',
      prompt: 'hi',
      profile: 'claude'
    }, { runId: 'run1', dataDir });
    expect(agent.id).toBe('s1');
  });

  it('launches an untagged operator CLI Agent without a live title or journal', async () => {
    const dataDir = tmpData();
    const { url } = await boot([
      {
        method: 'POST',
        path: '/api/v1/cli-agents',
        handler: (_url, body) => {
          expect(body).toMatchObject({ projectId: 'p1', profile: 'claude', title: 'Work' });
          expect(String((body as { title?: string }).title ?? '')).not.toContain('[zcc-live:');
          return { status: 201, body: { session: { id: 's-op', projectId: 'p1', profile: 'claude', status: 'working' } } };
        }
      }
    ]);
    const agent = await launchCliAgent(new ProductHttpClient(url), {
      projectId: 'p1',
      prompt: 'hi',
      profile: 'claude',
      title: 'Work'
    }, { runId: 'run1', dataDir, tagged: false });
    expect(agent.id).toBe('s-op');
    expect(readJournal(dataDir, 'run1')).toBeNull();
  });
});

describe('sandbox, health, cleanup', () => {
  it('reuses a live-sandbox project and stamps journals', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/projects', body: { projects: [{ id: 'p1', name: 'live-sandbox' }] } }
    ]);
    const project = await ensureLiveSandbox(new ProductHttpClient(url));
    expect(project.id).toBe('p1');
  });

  it('creates a sandbox when missing', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/projects', body: { projects: [] } },
      { method: 'POST', path: '/api/v1/projects', body: { project: { id: 'p-new', path: '/tmp/live-sandbox' } } },
      { method: 'PATCH', path: '/api/v1/projects/p-new', body: { project: { id: 'p-new', name: 'live-sandbox' } } }
    ]);
    const project = await ensureLiveSandbox(new ProductHttpClient(url), { path: '/tmp/live-sandbox' });
    expect(project.id).toBe('p-new');
  });

  it('reports host health', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      { method: 'GET', path: '/api/v1/hosts', body: [{ id: 'h1', status: 'connected' }] }
    ]);
    await expect(health(new ProductHttpClient(url))).resolves.toEqual({ ok: true, hostConnected: true });
  });

  it('skips unavailable harnesses', async () => {
    const { url } = await boot([
      {
        method: 'GET',
        path: '/api/v1/harness/verify',
        body: { results: [{ family: 'cursor', enabled: false, installed: false, label: 'Cursor' }] }
      }
    ]);
    await expect(preflight(new ProductHttpClient(url), { surface: 'thread', providerId: 'acp-cursor' }))
      .rejects.toMatchObject({ code: 'PREFLIGHT' });
  });

  it('stops tagged sessions on cleanup', async () => {
    const dataDir = tmpData();
    appendJournalIds(dataDir, 'run1', { threadIds: ['thr-1'], cliAgentIds: ['s1'], projectId: 'p1' });
    const { url, calls } = await boot([
      { method: 'GET', path: '/api/v1/threads', body: { threads: [{ id: 'thr-1', title: liveTitle('run1') }] } },
      { method: 'POST', path: '/api/v1/threads/thr-1/stop', body: { ok: true } },
      { method: 'GET', path: '/api/v1/cli-agents', body: { sessions: [{ id: 's1' }] } },
      { method: 'POST', path: '/api/v1/cli-agents/s1/stop', body: { ok: true } },
      { method: 'GET', path: '/api/v1/projects/p1/processes', body: { processes: [{ pid: 42 }] } },
      { method: 'POST', path: '/api/v1/projects/p1/processes/kill', body: { killed: [{ pid: 42 }] } },
      {
        method: 'GET',
        path: '/api/v1/projects/p1/environments',
        body: {
          environments: [
            { id: 'env-wt', workspaceProvisionType: 'managed-worktree' },
            { id: 'env-unmanaged', workspaceProvisionType: 'unmanaged' }
          ]
        }
      },
      { method: 'DELETE', path: '/api/v1/environments/env-wt', body: { ok: true } }
    ]);
    const result = await cleanupRun(new ProductHttpClient(url), dataDir, 'run1');
    expect(result.stoppedThreads).toContain('thr-1');
    expect(result.stoppedAgents).toContain('s1');
    expect(result.killedPids).toContain(42);
    expect(result.destroyedEnvironments).toContain('env-wt');
    expect(result.destroyedEnvironments).not.toContain('env-unmanaged');
    expect(calls.some((call) => call.path === '/api/v1/environments/env-unmanaged')).toBe(false);
    expect(calls.some((call) => call.path.endsWith('/stop'))).toBe(true);
    expect(readJournal(dataDir, 'run1')).toBeNull();
  });
});

describe('Zcc.connect', () => {
  it('connects and exposes health', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      { method: 'GET', path: '/api/v1/hosts', body: [] }
    ]);
    const zcc = await Zcc.connect({ serverUrl: url, dataDir: tmpData() });
    expect(zcc.serverUrl).toBe(url);
    await expect(zcc.health()).resolves.toMatchObject({ ok: true });
  });

  it('discovers a healthy 8780 when neither URL is explicit', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input instanceof Request ? input.url : input);
      if (href.startsWith('http://127.0.0.1:8780/') && href.includes('/health')) {
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    }) as typeof fetch;
    const resolved = await resolveConnect({ fetchImpl });
    expect(resolved.serverUrl).toBe('http://127.0.0.1:8780');
    expect(resolved.dataDir).toContain('.zcc');
  });

  it('discovers 8781 when only the dev server answers', async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const href = String(input instanceof Request ? input.url : input);
      if (href.startsWith('http://127.0.0.1:8781/') && href.includes('/health')) {
        return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: false }), { status: 500 });
    }) as typeof fetch;
    const resolved = await resolveConnect({ fetchImpl, dataDir: tmpData() });
    expect(resolved.serverUrl).toBe('http://127.0.0.1:8781');
  });

  it('throws AMBIGUOUS_SERVER when both ports answer', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
    ) as typeof fetch;
    await expect(resolveConnect({ fetchImpl })).rejects.toMatchObject({ code: 'AMBIGUOUS_SERVER' });
  });
});

describe('tags', () => {
  it('mints a short run id and title prefix', () => {
    expect(createRunId('abc')).toBe('abc');
    expect(createRunId().length).toBe(8);
    expect(liveTitle('abc', 'hello')).toBe('[zcc-live:abc] hello');
    expect(liveTitle('abc')).toBe('[zcc-live:abc]');
    expect(titleMatchesRun('[zcc-live:abc] hello', 'abc')).toBe(true);
    expect(titleMatchesRun('other', 'abc')).toBe(false);
    expect(titleMatchesRun(null, 'abc')).toBe(false);
  });

  it('lists journals from disk', () => {
    const dataDir = tmpData();
    writeJournal(dataDir, {
      runId: 'r1',
      createdAt: 1,
      threadIds: ['t1'],
      cliAgentIds: [],
      environmentIds: []
    });
    expect(listJournals(dataDir).map((row) => row.runId)).toEqual(['r1']);
  });
});

describe('errors and matrix', () => {
  it('maps control errors to CLI exit codes', () => {
    expect(exitCodeForControlError(new ControlError('FORBIDDEN_AGENT', 'x'))).toBe(5);
    expect(exitCodeForControlError(new ControlError('NOT_FOUND', 'x'))).toBe(3);
    expect(exitCodeForControlError(new ControlError('BAD_USAGE', 'x'))).toBe(2);
    expect(exitCodeForControlError(new ControlError('ROLE_XOR_MODEL', 'x'))).toBe(2);
    expect(exitCodeForControlError(new ControlError('FAKE_ATTACH', 'x'))).toBe(2);
    expect(exitCodeForControlError(new ControlError('TIMEOUT', 'x'))).toBe(124);
    expect(exitCodeForControlError(new ControlError('HTTP_ERROR', 'x'))).toBe(1);
  });

  it('skips preflight failures instead of throwing', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      {
        method: 'GET',
        path: '/api/v1/harness/verify',
        body: { results: [{ family: 'cursor', enabled: false, installed: false, label: 'Cursor' }] }
      }
    ]);
    const zcc = await Zcc.connect({ serverUrl: url, dataDir: tmpData() });
    const skipped = await preflightOrSkip(zcc, { surface: 'thread', providerId: 'acp-cursor' });
    expect(isSkip(skipped)).toBe(true);
    expect(liveEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe('thread and CLI agent handles', () => {
  it('sends, forks, stops, and asserts health', async () => {
    const dataDir = tmpData();
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      { method: 'GET', path: '/api/v1/projects', body: { projects: [{ id: 'p1', name: 'live-sandbox' }] } },
      {
        method: 'GET',
        path: '/api/v1/harness/verify',
        body: { results: [{ family: 'claude', enabled: true, installed: true, label: 'Claude Code' }] }
      },
      {
        method: 'POST',
        path: '/api/v1/threads',
        body: { thread: { id: 'thr-1', status: 'idle', projectId: 'p1' } }
      },
      { method: 'GET', path: '/api/v1/threads/thr-1', body: { thread: { id: 'thr-1', status: 'idle', projectId: 'p1' } } },
      { method: 'GET', path: '/api/v1/threads/thr-1/interactions', body: [] },
      { method: 'POST', path: '/api/v1/threads/thr-1/send', body: { thread: { id: 'thr-1', status: 'active' } } },
      { method: 'POST', path: '/api/v1/threads/thr-1/stop', body: { ok: true } },
      { method: 'POST', path: '/api/v1/threads/thr-1/fork', body: { thread: { id: 'thr-2', status: 'idle' } } },
      { method: 'GET', path: '/api/v1/threads/thr-1/timeline', body: { events: [] } },
      { method: 'GET', path: '/api/v1/threads/thr-1/events', body: { events: [{ type: 'turn/completed' }] } },
      { method: 'GET', path: '/api/v1/threads/thr-1/events/wait', body: { type: 'turn/completed' } },
      {
        method: 'POST',
        path: '/api/v1/threads/thr-1/interactions/i1/resolve',
        body: { ok: true }
      }
    ]);
    const zcc = await Zcc.connect({ serverUrl: url, dataDir, runId: 'runx' });
    await expect(zcc.projects.list()).resolves.toEqual([{ id: 'p1', name: 'live-sandbox' }]);
    await expect(zcc.harness.preflight({ surface: 'thread', providerId: 'claude-code' }))
      .resolves.toMatchObject({ family: 'claude' });
    expect(threadIsQuiet({ id: 'thr-1', status: 'idle' }, 'idle')).toBe(true);
    expect(threadIsQuiet({ id: 'thr-1', status: 'idle', activity: { activeBackgroundCommandCount: 1 } }, 'quiet')).toBe(false);
    expect(threadIsQuiet({ id: 'thr-1', status: 'error' }, 'error')).toBe(true);
    const thread = await zcc.threads.spawn({ projectId: 'p1', prompt: 'hi' });
    expect(thread.snapshot().id).toBe('thr-1');
    expect(thread.status).toBe('idle');
    await expect(thread.refresh()).resolves.toMatchObject({ id: 'thr-1' });
    await expect(thread.send('again')).resolves.toMatchObject({ status: 'active' });
    await expect(thread.timeline()).resolves.toMatchObject({ events: [] });
    await expect(thread.interactions()).resolves.toEqual([]);
    await expect(thread.waitForEvent('turn/completed')).resolves.toMatchObject({ type: 'turn/completed' });
    await expect(thread.resolveInteraction('i1', { decision: 'deny' })).resolves.toMatchObject({ ok: true });
    await expect(thread.assertHealthy()).resolves.toMatchObject({ status: 'idle' });
    const forked = await thread.fork();
    expect(forked.id).toBe('thr-2');
    await thread.stop();
    await zcc.close();
  });

  it('throws UNHEALTHY when assertHealthy sees error', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      {
        method: 'POST',
        path: '/api/v1/threads',
        body: { thread: { id: 'thr-err', status: 'error' } }
      },
      { method: 'GET', path: '/api/v1/threads/thr-err', body: { thread: { id: 'thr-err', status: 'error' } } }
    ]);
    const zcc = await Zcc.connect({ serverUrl: url, dataDir: tmpData() });
    const thread = await zcc.threads.spawn({ projectId: 'p1', prompt: 'x' });
    await expect(thread.assertHealthy()).rejects.toMatchObject({ code: 'UNHEALTHY' });
  });

  it('waits, replies, and stops a CLI agent', async () => {
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      {
        method: 'POST',
        path: '/api/v1/cli-agents',
        body: { session: { id: 's1', projectId: 'p1', profile: 'claude', status: 'working' } }
      },
      { method: 'GET', path: '/api/v1/cli-agents/s1', body: { session: { id: 's1', status: 'idle' } } },
      { method: 'POST', path: '/api/v1/cli-agents/s1/reply', body: { ok: true } },
      { method: 'POST', path: '/api/v1/cli-agents/s1/stop', body: { ok: true } }
    ]);
    const zcc = await Zcc.connect({ serverUrl: url, dataDir: tmpData() });
    const agent = await zcc.cliAgents.launch({ projectId: 'p1', prompt: 'hi', profile: 'claude' });
    expect(agent.status).toBe('working');
    await expect(agent.wait({ until: 'idle', timeoutMs: 1_000 })).resolves.toMatchObject({ status: 'idle' });
    await agent.reply('again');
    await agent.stop();
  });

  it('times out a CLI agent wait', async () => {
    const { url } = await boot([
      {
        method: 'POST',
        path: '/api/v1/cli-agents',
        body: { session: { id: 's1', projectId: 'p1', profile: 'claude', status: 'working' } }
      },
      { method: 'GET', path: '/api/v1/cli-agents/s1', body: { session: { id: 's1', status: 'working' } } }
    ]);
    const agent = await launchCliAgent(new ProductHttpClient(url), {
      projectId: 'p1',
      prompt: 'hi',
      profile: 'claude'
    }, { runId: 'r', dataDir: tmpData() });
    await expect(agent.wait({ until: 'idle', timeoutMs: 10 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('waits until needs_you and approves safely', async () => {
    let resolved = false;
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/threads/thr-1', body: { thread: { id: 'thr-1', status: 'waiting' } } },
      {
        method: 'GET',
        path: '/api/v1/threads/thr-1/interactions',
        handler: () => ({ body: { interactions: resolved ? [] : [{ id: 'i1', prompt: 'Allow?' }] } })
      },
      {
        method: 'POST',
        path: '/api/v1/threads/thr-1/interactions/i1/resolve',
        handler: (_url, body) => {
          expect(body).toMatchObject({ decision: 'allow_once' });
          resolved = true;
          return { body: { ok: true } };
        }
      }
    ]);
    const http = new ProductHttpClient(url);
    await expect(waitForThreadStatus(http, 'thr-1', { until: 'needs_you', timeoutMs: 1_000 }))
      .resolves.toMatchObject({ status: 'waiting' });
    await expect(waitForThreadStatus(http, 'thr-1', {
      until: 'idle',
      timeoutMs: 2_000,
      onInteraction: 'approve-safe'
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });

  it('cleans stale journals through Zcc.cleanup', async () => {
    const dataDir = tmpData();
    appendJournalIds(dataDir, 'old', { threadIds: ['thr-1'] });
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      { method: 'GET', path: '/api/v1/threads', body: { threads: [] } },
      { method: 'POST', path: '/api/v1/threads/thr-1/stop', body: { ok: true } },
      { method: 'GET', path: '/api/v1/cli-agents', body: { sessions: [] } }
    ]);
    const zcc = await Zcc.connect({ serverUrl: url, dataDir });
    await expect(zcc.cleanup({ stale: true })).resolves.toEqual(['old']);
    await expect(cleanupStale(zcc.http, dataDir)).resolves.toEqual([]);
  });
});

describe('desktop browsers', () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
  const scope = {
    hostId: 'h1',
    instanceId: 'inst-1',
    generation: 'gen-1',
    threadId: 'thr-1'
  };

  it('runs a create/acquire/connection/capture/release/close cycle', async () => {
    const { url, calls } = await boot([
      { method: 'GET', path: '/api/v1/health', body: { ok: true } },
      { method: 'GET', path: '/api/v1/hosts', body: [{ id: 'h1', status: 'connected', isPrimary: true }] },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/instances',
        body: { instances: [{ instanceId: 'inst-1', generation: 'gen-1', label: 'ZCC window 1' }] }
      },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/create',
        handler: (_url, body) => {
          expect(body).toMatchObject({ ...scope, url: 'about:blank', presentation: 'hidden' });
          return { body: { tab: { tabId: 'browser:1', threadId: 'thr-1', url: 'about:blank' } } };
        }
      },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/acquire',
        handler: (_url, body) => {
          expect(body).toMatchObject({
            tabIds: expect.any(Array),
            controllerLabel: expect.any(String)
          });
          return { body: { ...scope, leaseId: 'lease-1', tabIds: ['browser:1'], controllerLabel: 'zcc-live', expiresAt: 1 } };
        }
      },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/connection',
        body: { hostId: 'h1', wsEndpoint: 'ws://127.0.0.1:9333/cdp/abc', expiresAt: 1 }
      },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/capture',
        body: { mimeType: 'image/jpeg', width: 2, height: 2, base64: jpeg }
      },
      { method: 'POST', path: '/api/v1/desktop-browsers/release', body: { ok: true } },
      { method: 'POST', path: '/api/v1/desktop-browsers/close', body: { ok: true } },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/import-sources',
        body: { sources: [{ id: 'chrome', profiles: [{ directory: 'Default', cookieCount: 3 }] }] }
      },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/import-cookies',
        body: { ok: true, imported: 1, skipped: 0 }
      },
      { method: 'POST', path: '/api/v1/desktop-browsers/tabs', body: { tabs: [{ tabId: 'browser:1' }] } },
      { method: 'POST', path: '/api/v1/desktop-browsers/reveal', body: { ok: true } }
    ]);
    const zcc = await Zcc.connect({ serverUrl: url, dataDir: tmpData() });
    await expect(zcc.hosts.list()).resolves.toEqual([{ id: 'h1', status: 'connected', isPrimary: true }]);
    const picked = await zcc.browsers.pickInstance();
    expect(isSkip(picked)).toBe(false);
    if (isSkip(picked)) throw new Error('unexpected skip');
    expect(picked.instance.instanceId).toBe('inst-1');
    expect(picked.instance.hostId).toBe('h1');
    const handle = zcc.browsers.session({ ...picked.instance, threadId: 'thr-1' });
    const cycle = await runDesktopBrowserLeaseCycle(handle, { probeCdp: false });
    expect(cycle.tabId).toBe('browser:1');
    expect(cycle.leaseId).toBe('lease-1');
    expect(cycle.wsEndpoint).toBe('ws://127.0.0.1:9333/cdp/abc');
    expect(jpegMagicOk(cycle.capture.base64)).toBe(true);
    await expect(handle.listTabs()).resolves.toEqual({ tabs: [{ tabId: 'browser:1' }] });
    await handle.reveal('browser:1');
    const sources = await zcc.browsers.listImportSources(picked.instance);
    expect(importSourcesLeakCookieMaterial(sources)).toBe(false);
    await expect(zcc.browsers.importCookies({
      ...picked.instance,
      sourceId: 'chrome',
      sourceProfileDirectory: 'Default'
    })).resolves.toMatchObject({ ok: true, imported: 1 });
    const personal = await handle.acquire({
      tabIds: ['browser:1'],
      controllerLabel: 'handoff',
      allowPersonal: true,
      ttlMs: 5_000
    });
    expect(personal.leaseId).toBe('lease-1');
    expect(calls.some((call) => call.path === '/api/v1/desktop-browsers/acquire' && (call.body as { allowPersonal?: boolean }).allowPersonal === true)).toBe(true);
    expect(calls.some((call) => call.path === '/api/v1/desktop-browsers/release')).toBe(true);
    expect(calls.some((call) => call.path === '/api/v1/desktop-browsers/close')).toBe(true);
  });

  it('skips isolated stacks and empty desktops', async () => {
    expect(isSkip(await pickDesktopBrowserInstance(new ProductHttpClient('http://127.0.0.1:1'), { isolated: true }))).toBe(true);
    await expect(pickDesktopBrowserInstance(new ProductHttpClient('http://127.0.0.1:1'))).rejects.toMatchObject({
      code: 'APP_NOT_RUNNING'
    });
    const { url } = await boot([
      { method: 'GET', path: '/api/v1/hosts', body: [{ id: 'h1', name: 'Laptop', status: 'disconnected' }] }
    ]);
    const skippedHost = await pickDesktopBrowserInstance(new ProductHttpClient(url));
    expect(isSkip(skippedHost)).toBe(true);
    if (isSkip(skippedHost)) expect(skippedHost.reason).toMatch(/No connected host/);

    const empty = await boot([
      { method: 'GET', path: '/api/v1/hosts', body: { hosts: [null, { id: '' }, { id: 'h1', status: 'connected' }] } },
      { method: 'POST', path: '/api/v1/desktop-browsers/instances', body: { instances: [] } }
    ]);
    const skippedEmpty = await pickDesktopBrowserInstance(new ProductHttpClient(empty.url));
    expect(isSkip(skippedEmpty)).toBe(true);
    expect(isSkip(await pickDesktopBrowserInstance(new ProductHttpClient(empty.url), { hostId: 'nope' }))).toBe(true);

    const unavailable = await boot([
      { method: 'GET', path: '/api/v1/hosts', body: [{ id: 'h1', status: 'online' }] },
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/instances',
        status: 503,
        body: { error: 'desktop_browser_unavailable', message: 'Desktop browser is only available in the desktop app.' }
      }
    ]);
    await expect(pickDesktopBrowserInstance(new ProductHttpClient(unavailable.url))).rejects.toMatchObject({
      code: 'HTTP_ERROR',
      status: 503
    });

    const badHosts = await boot([
      { method: 'GET', path: '/api/v1/hosts', status: 500, body: { message: 'boom' } }
    ]);
    const skippedList = await pickDesktopBrowserInstance(new ProductHttpClient(badHosts.url));
    expect(isSkip(skippedList)).toBe(true);

    const invalid = await boot([
      { method: 'GET', path: '/api/v1/hosts', body: [{ id: 'h1', status: 'connected' }] },
      { method: 'POST', path: '/api/v1/desktop-browsers/instances', status: 400, body: { error: 'invalid desktop-browser request' } }
    ]);
    await expect(pickDesktopBrowserInstance(new ProductHttpClient(invalid.url))).rejects.toMatchObject({
      code: 'HTTP_ERROR'
    });
  });

  it('rejects missing tab/lease/connection payloads and non-loopback CDP', async () => {
    const { url } = await boot([
      { method: 'POST', path: '/api/v1/desktop-browsers/create', body: { tab: {} } },
      { method: 'POST', path: '/api/v1/desktop-browsers/acquire', body: {} },
      { method: 'POST', path: '/api/v1/desktop-browsers/connection', body: { hostId: 'h1', expiresAt: 1 } },
      { method: 'POST', path: '/api/v1/desktop-browsers/capture', body: { mimeType: 'image/jpeg', base64: '' } }
    ]);
    const handle = new DesktopBrowserHandle(new ProductHttpClient(url), {
      hostId: 'h1',
      instanceId: 'inst-1',
      generation: 'gen-1',
      threadId: 'thr-1'
    });
    await expect(handle.create()).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    await expect(handle.acquire({ tabIds: ['t1'], controllerLabel: 'x' })).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    await expect(handle.connection('lease-1')).rejects.toMatchObject({ code: 'HTTP_ERROR' });
    await expect(handle.capture('t1')).rejects.toMatchObject({ code: 'HTTP_ERROR' });
  });

  it('rejects non-loopback CDP endpoints and cookie leaks', async () => {
    expect(() => assertLoopbackWs('wss://example.test/cdp')).toThrow(/non-loopback/);
    expect(() => assertLoopbackWs('ws://user:pass@127.0.0.1/cdp')).toThrow(/non-loopback/);
    expect(() => assertLoopbackWs('not a url')).toThrow(/malformed/);
    expect(() => assertLoopbackWs('ws://127.0.0.1:9/cdp')).not.toThrow();
    expect(jpegMagicOk('not-a-jpeg')).toBe(false);
    expect(importSourcesLeakCookieMaterial({ sources: [{ cookies: [{ value: 'secret' }] }] })).toBe(true);
    expect(importSourcesLeakCookieMaterial({ sources: [{ id: 'chrome', encrypted_value: 'x' }] })).toBe(true);
    expect(importSourcesLeakCookieMaterial({ sources: [{ id: 'chrome' }] })).toBe(false);
    expect(() => planDesktopBrowserImportProbe({ sources: [] })).toThrow(/empty/);
    expect(planDesktopBrowserImportProbe({
      sources: [{ id: 'chrome', unavailable: 'browserRunning', profiles: [] }]
    })).toEqual({
      sourceId: 'chrome',
      sourceProfileDirectory: '__zcc-live-missing-profile__',
      copiesCookies: false
    });
    expect(planDesktopBrowserImportProbe({
      sources: [{ id: 'chrome', profiles: [{ directory: 'Default', name: 'Person 1' }] }]
    })).toEqual({
      sourceId: 'chrome',
      sourceProfileDirectory: '__zcc-live-missing-profile__',
      copiesCookies: false
    });
    expect(planDesktopBrowserImportProbe(
      { sources: [{ id: 'firefox', profiles: [{ directory: 'Profiles/p1', name: 'p1' }] }] },
      { copyCookies: true }
    )).toEqual({
      sourceId: 'firefox',
      sourceProfileDirectory: 'Profiles/p1',
      copiesCookies: true
    });
    expect(planDesktopBrowserImportProbe(
      {
        sources: [
          { id: 'chrome', unavailable: 'browserRunning', profiles: [] },
          { id: 'firefox', profiles: [{ directory: 'Profiles/p1', name: 'p1' }] }
        ]
      },
      { copyCookies: true }
    )).toEqual({
      sourceId: 'firefox',
      sourceProfileDirectory: 'Profiles/p1',
      copiesCookies: true
    });
    expect(planDesktopBrowserImportProbe(
      { sources: [{ id: 'chrome', unavailable: 'browserRunning', profiles: [{ directory: 'Default', name: 'Person 1' }] }] },
      { copyCookies: true }
    )).toEqual({
      sourceId: 'chrome',
      sourceProfileDirectory: '__zcc-live-missing-profile__',
      copiesCookies: false
    });
    expect(() => parseDesktopBrowserImportOutcome({ ok: true })).toThrow(/malformed/);
    expect(parseDesktopBrowserImportOutcome({ ok: false, reason: 'browserRunning' })).toEqual({
      ok: false,
      reason: 'browserRunning'
    });
    expect(parseDesktopBrowserImportOutcome({ ok: true, imported: 2, skipped: 1, skippedDomains: [] })).toEqual({
      ok: true,
      imported: 2,
      skipped: 1
    });
    expect(() => parseDesktopBrowserImportOutcome({ ok: false, reason: 'nope' })).toThrow(/malformed/);
    expect(() => parseDesktopBrowserImportOutcome({ ok: true, cookies: [{ value: 'secret' }] })).toThrow(/leaked/);
    expect(() => parseDesktopBrowserImportOutcome(null)).toThrow(/malformed/);
    expect(() => parseDesktopBrowserImportOutcome({ ok: false })).toThrow(/malformed/);
    expect(() => planDesktopBrowserImportProbe({ sources: [{ id: 'not-a-browser', profiles: [] }] })).toThrow(/empty/);
    await expect(probeLoopbackCdpVersion('wss://example.test/cdp')).rejects.toThrow(/non-loopback/);
  });

  it('probes cookie import into the automation partition without copying cookies', async () => {
    const { url, calls } = await boot([
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/import-cookies',
        handler: (_url, body) => {
          expect(body).toMatchObject({
            hostId: 'h1',
            instanceId: 'inst-1',
            generation: 'gen-1',
            sourceId: 'chrome',
            sourceProfileDirectory: '__zcc-live-missing-profile__',
            profile: { kind: 'automation', id: 'thr-live' }
          });
          return { body: { ok: false, reason: 'browserRunning' } };
        }
      }
    ]);
    const probe = await runDesktopBrowserImportProbe(new ProductHttpClient(url), {
      hostId: 'h1',
      instanceId: 'inst-1',
      generation: 'gen-1',
      threadId: 'thr-live',
      sources: { sources: [{ id: 'chrome', unavailable: 'browserRunning', profiles: [] }] }
    });
    expect(probe).toEqual({
      sourceId: 'chrome',
      sourceProfileDirectory: '__zcc-live-missing-profile__',
      copiesCookies: false,
      outcome: { ok: false, reason: 'browserRunning' }
    });
    expect(calls).toHaveLength(1);

    const copied = await boot([
      { method: 'POST', path: '/api/v1/desktop-browsers/import-cookies', body: { ok: true, imported: 3, skipped: 0 } }
    ]);
    await expect(runDesktopBrowserImportProbe(new ProductHttpClient(copied.url), {
      hostId: 'h1',
      instanceId: 'inst-1',
      generation: 'gen-1',
      threadId: 'thr-live',
      sources: { sources: [{ id: 'chrome', unavailable: 'browserRunning', profiles: [] }] }
    })).rejects.toMatchObject({ code: 'HTTP_ERROR' });

    const allowCopy = await boot([
      {
        method: 'POST',
        path: '/api/v1/desktop-browsers/import-cookies',
        handler: (_url, body) => {
          expect(body).toMatchObject({
            sourceId: 'firefox',
            sourceProfileDirectory: 'Profiles/p1',
            profile: { kind: 'automation', id: 'thr-live' }
          });
          return { body: { ok: true, imported: 1, skipped: 0, skippedDomains: [] } };
        }
      }
    ]);
    await expect(runDesktopBrowserImportProbe(new ProductHttpClient(allowCopy.url), {
      hostId: 'h1',
      instanceId: 'inst-1',
      generation: 'gen-1',
      threadId: 'thr-live',
      sources: { sources: [{ id: 'firefox', profiles: [{ directory: 'Profiles/p1', name: 'p1' }] }] },
      copyCookies: true
    })).resolves.toMatchObject({ copiesCookies: true, outcome: { ok: true, imported: 1 } });
  });

  it('probes loopback CDP over a fake WebSocket', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');
    type CdpBehavior = 'ok' | 'error' | 'timeout' | 'bad-json' | 'no-product';
    let behavior: CdpBehavior = 'ok';
    class FakeWs extends EventTarget {
      constructor(_url: string) {
        super();
        queueMicrotask(() => {
          if (behavior === 'error') {
            this.dispatchEvent(new Event('error'));
            return;
          }
          this.dispatchEvent(new Event('open'));
        });
      }
      send(_data: string) {
        queueMicrotask(() => {
          if (behavior === 'timeout') return;
          if (behavior === 'bad-json') {
            this.dispatchEvent(new MessageEvent('message', { data: 'nope' }));
            return;
          }
          const product = behavior === 'no-product' ? 1 : 'Chrome/1';
          this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ result: { product } }) }));
        });
      }
      close() {
        throw new Error('already closed');
      }
    }
    const original = globalThis.WebSocket;
    globalThis.WebSocket = FakeWs as unknown as typeof WebSocket;
    try {
      behavior = 'ok';
      await expect(probeLoopbackCdpVersion('ws://127.0.0.1:9/cdp')).resolves.toEqual({ product: 'Chrome/1' });
      behavior = 'no-product';
      await expect(probeLoopbackCdpVersion('ws://127.0.0.1:9/cdp')).resolves.toEqual({ product: undefined });
      behavior = 'bad-json';
      await expect(probeLoopbackCdpVersion('ws://127.0.0.1:9/cdp')).rejects.toMatchObject({ code: 'HTTP_ERROR' });
      behavior = 'error';
      await expect(probeLoopbackCdpVersion('ws://127.0.0.1:9/cdp')).rejects.toThrow(/CDP WebSocket failed/);
      behavior = 'timeout';
      await expect(probeLoopbackCdpVersion('ws://127.0.0.1:9/cdp', 20)).rejects.toMatchObject({ code: 'TIMEOUT' });

      const { url } = await boot([
        {
          method: 'POST',
          path: '/api/v1/desktop-browsers/create',
          body: { tab: { tabId: 'browser:1' } }
        },
        {
          method: 'POST',
          path: '/api/v1/desktop-browsers/acquire',
          body: { leaseId: 'lease-1' }
        },
        {
          method: 'POST',
          path: '/api/v1/desktop-browsers/connection',
          body: { hostId: 'h1', wsEndpoint: 'ws://127.0.0.1:9/cdp', expiresAt: 1 }
        },
        {
          method: 'POST',
          path: '/api/v1/desktop-browsers/capture',
          body: { mimeType: 'image/jpeg', width: 1, height: 1, base64: jpeg }
        },
        { method: 'POST', path: '/api/v1/desktop-browsers/release', body: { ok: true } },
        { method: 'POST', path: '/api/v1/desktop-browsers/close', body: { ok: true } }
      ]);
      behavior = 'ok';
      const cycle = await runDesktopBrowserLeaseCycle(new DesktopBrowserHandle(new ProductHttpClient(url), {
        hostId: 'h1',
        instanceId: 'inst-1',
        generation: 'gen-1',
        threadId: 'thr-1'
      }), { probeCdp: true, url: 'https://example.test', controllerLabel: 'script', ttlMs: 5_000 });
      expect(cycle.cdpProduct).toBe('Chrome/1');
    } finally {
      globalThis.WebSocket = original;
    }

    const previous = globalThis.WebSocket;
    // @ts-expect-error -- cover the missing-WebSocket branch
    globalThis.WebSocket = undefined;
    try {
      await expect(probeLoopbackCdpVersion('ws://127.0.0.1:9/cdp')).rejects.toThrow(/not available/);
    } finally {
      globalThis.WebSocket = previous;
    }
  });
});
