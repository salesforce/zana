import { describe, expect, it } from 'vitest';
import { runCli } from '../run-cli.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function router(routes: Record<string, unknown | ((url: URL, init?: RequestInit) => unknown)>): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const key = `${method} ${url.pathname}`;
    const handler = routes[key];
    if (handler === undefined) {
      return jsonResponse(404, { error: `unmocked ${key}` });
    }
    const body = typeof handler === 'function' ? handler(url, init) : handler;
    if (body instanceof Response) return body;
    return jsonResponse(200, body);
  }) as typeof fetch;
}

const sampleThread = {
  id: 'thr-1',
  status: 'idle',
  projectId: 'proj-1',
  title: 'Review',
  hostId: 'local',
  environmentId: null
};

describe('product API command groups', () => {
  it('lists and shows threads', async () => {
    const fetchImpl = router({
      'GET /api/v1/threads': { threads: [sampleThread] },
      'GET /api/v1/threads/thr-1': { thread: sampleThread }
    });
    const listed = await runCli(['node', 'zcc', 'thread', 'list', '--json'], { fetchImpl });
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout)[0].id).toBe('thr-1');
    const shown = await runCli(['node', 'zcc', 'thread', 'show', 'thr-1'], { fetchImpl });
    expect(shown.stdout).toContain('thr-1');
  });

  it('spawns, tells, waits, and stops a thread', async () => {
    let status = 'active';
    let told = '';
    const fetchImpl = router({
      'POST /api/v1/threads': (_url, init) => {
        const body = JSON.parse(String(init?.body));
        expect(body.projectId).toBe('proj-1');
        expect(body.prompt).toContain('review');
        return jsonResponse(201, { thread: { ...sampleThread, status: 'starting' } });
      },
      'POST /api/v1/threads/thr-1/send': (_url, init) => {
        told = JSON.parse(String(init?.body)).text;
        return { thread: sampleThread };
      },
      'GET /api/v1/threads/thr-1': () => ({ thread: { ...sampleThread, status } }),
      'POST /api/v1/threads/thr-1/stop': { ok: true }
    });
    const spawned = await runCli(
      ['node', 'zcc', 'thread', 'spawn', '--project', 'proj-1', '--', 'review', 'the', '--wait', 'handler'],
      { fetchImpl }
    );
    expect(spawned.exitCode).toBe(0);
    expect(spawned.stdout).toContain('thr-1');

    const sent = await runCli(['node', 'zcc', 'thread', 'tell', 'thr-1', 'also', 'check'], { fetchImpl });
    expect(sent.exitCode).toBe(0);
    expect(told).toBe('also check');

    status = 'idle';
    let now = 0;
    const waited = await runCli(['node', 'zcc', 'thread', 'wait', 'thr-1', '--timeout', '2s'], {
      fetchImpl,
      nowMs: () => now,
      sleep: async () => {
        now += 500;
      }
    });
    expect(waited.exitCode).toBe(0);
    expect(waited.stdout).toContain('idle');

    const stopped = await runCli(['node', 'zcc', 'thread', 'stop', 'thr-1'], { fetchImpl });
    expect(stopped.stdout).toContain('stopped');
  });

  it('prints a deprecation on zcc run / agent send / term', async () => {
    const fetchImpl = router({
      'POST /api/v1/threads': jsonResponse(201, { thread: sampleThread }),
      'POST /api/v1/threads/thr-1/send': { thread: sampleThread },
      'GET /api/v1/terminals': { sessions: [] },
      'POST /api/v1/terminals/s1/close': { ok: true }
    });
    const run = await runCli(['node', 'zcc', 'run', 'proj-1', 'hello'], { fetchImpl });
    expect(run.exitCode).toBe(0);
    expect(run.stderr).toMatch(/deprecated.*thread spawn/);
    const send = await runCli(['node', 'zcc', 'agent', 'send', 'thr-1', 'hi'], { fetchImpl });
    expect(send.stderr).toMatch(/deprecated.*thread tell/);
    const term = await runCli(['node', 'zcc', 'term', 'ls'], { fetchImpl });
    expect(term.stderr).toMatch(/deprecated.*terminal/);
    const closed = await runCli(['node', 'zcc', 'term', 'close', 's1'], { fetchImpl });
    expect(closed.stderr).toMatch(/deprecated/);
    expect(closed.stdout).toContain('closed');
  });

  it('lists machines, projects, skills, settings, terminals, environments', async () => {
    const fetchImpl = router({
      'GET /api/v1/hosts': [{ id: 'h1', name: 'Laptop', status: 'connected' }],
      'GET /api/v1/projects': { projects: [{ id: 'p1', name: 'App', tag: 'app', path: '/tmp/app' }] },
      'GET /api/v1/plugins/contributions': { pluginSkills: [{ pluginId: 'tasks', name: 'Tasks', skillNames: ['tasks'] }] },
      'GET /api/v1/config': { config: { theme: 'dark' } },
      'GET /api/v1/terminals': { sessions: [{ id: 's1', status: 'running', projectId: 'p1', title: 'dev' }] },
      'GET /api/v1/environments/e1/status': { dirty: false }
    });
    expect((await runCli(['node', 'zcc', 'machine', 'list'], { fetchImpl })).stdout).toContain('Laptop');
    expect((await runCli(['node', 'zcc', 'project', 'list', '--json'], { fetchImpl })).stdout).toContain('App');
    expect((await runCli(['node', 'zcc', 'skill', 'list'], { fetchImpl })).stdout).toContain('tasks');
    expect((await runCli(['node', 'zcc', 'settings', 'show', '--json'], { fetchImpl })).stdout).toContain('dark');
    expect((await runCli(['node', 'zcc', 'terminal', 'list'], { fetchImpl })).stdout).toContain('s1');
    expect((await runCli(['node', 'zcc', 'environment', 'status', 'e1', '--json'], { fetchImpl })).stdout).toContain('dirty');
  });

  it('status dashboard uses projects + threads', async () => {
    const fetchImpl = router({
      'GET /api/v1/projects': { projects: [{ id: 'p1' }] },
      'GET /api/v1/threads': { threads: [sampleThread] }
    });
    const result = await runCli(['node', 'zcc', 'status', '--json'], { fetchImpl });
    expect(JSON.parse(result.stdout)).toMatchObject({ projectCount: 1, threadCount: 1 });
  });

  it('creates a project and a terminal', async () => {
    const fetchImpl = router({
      'POST /api/v1/projects': { project: { id: 'p2', name: 'New', path: '/tmp/new' } },
      'POST /api/v1/terminals': { value: { id: 's2', status: 'running', projectId: 'p2', title: 'sh' } }
    });
    const created = await runCli(
      ['node', 'zcc', 'project', 'create', '--path', '/tmp/new', '--host', 'h1'],
      { fetchImpl }
    );
    expect(created.stdout).toContain('p2');
    const term = await runCli(
      ['node', 'zcc', 'terminal', 'create', '--project', 'p2', '--title', 'sh'],
      { fetchImpl }
    );
    expect(term.stdout).toContain('s2');
  });

  it('fails closed when the app is down', async () => {
    const result = await runCli(['node', 'zcc', 'thread', 'list'], {
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED');
      }
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/not running/);
  });

  it('covers remaining thread / machine / project / skill / settings verbs', async () => {
    const fetchImpl = router({
      'GET /api/v1/threads/thr-1/timeline': { events: [] },
      'GET /api/v1/threads/thr-1/interactions': { interactions: [] },
      'POST /api/v1/threads/thr-1/fork': { thread: { ...sampleThread, id: 'thr-2' } },
      'POST /api/v1/threads/thr-1/archive': { ok: true },
      'POST /api/v1/threads/thr-1/unarchive': { ok: true },
      'POST /api/v1/threads/thr-1/open': { ok: true },
      'GET /api/v1/hosts/h1': { id: 'h1', name: 'Laptop', status: 'connected' },
      'POST /api/v1/hosts/join-codes': { code: 'join-1' },
      'PATCH /api/v1/hosts/h1': { id: 'h1', name: 'Studio', status: 'connected' },
      'DELETE /api/v1/hosts/h1': { ok: true },
      'GET /api/v1/hosts/h1/provider-clis/status': { clis: [] },
      'POST /api/v1/hosts/h1/provider-clis/install': { ok: true },
      'GET /api/v1/projects': { projects: [{ id: 'p1', name: 'App', tag: 'app', path: '/tmp/app' }] },
      'GET /api/v1/projects/p1/paths': { paths: ['src/a.ts'] },
      'GET /api/v1/projects/p1/files/content': 'hello',
      'GET /api/v1/projects/p1/commands': { commands: [] },
      'GET /api/v1/plugins/contributions': { pluginSkills: [{ pluginId: 'tasks', skillNames: ['tasks'] }] },
      'GET /api/v1/system/cli-skills': { machines: [] },
      'POST /api/v1/system/cli-skills/install': { ok: true },
      'PATCH /api/v1/config': { config: { theme: 'light' } },
      'POST /api/v1/terminals/s1/input': { ok: true },
      'GET /api/v1/environments/e1/diff': { files: [] },
      'GET /api/v1/environments/e1/diff/files': { files: [] },
      'GET /api/v1/environments/e1/pull-request': { url: null }
    });
    expect((await runCli(['node', 'zcc', 'thread', 'log', 'thr-1', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'thread', 'fork', 'thr-1'], { fetchImpl })).stdout).toContain('thr-2');
    expect((await runCli(['node', 'zcc', 'thread', 'archive', 'thr-1'], { fetchImpl })).stdout).toContain('archived');
    expect((await runCli(['node', 'zcc', 'thread', 'unarchive', 'thr-1'], { fetchImpl })).stdout).toContain('unarchived');
    expect((await runCli(['node', 'zcc', 'thread', 'open', 'thr-1'], { fetchImpl })).stdout).toContain('opened');
    expect((await runCli(['node', 'zcc', 'thread', 'interactions', 'thr-1', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'machine', 'show', 'h1'], { fetchImpl })).stdout).toContain('Laptop');
    expect((await runCli(['node', 'zcc', 'machine', 'join-code', '--json'], { fetchImpl })).stdout).toContain('join-1');
    expect((await runCli(['node', 'zcc', 'machine', 'rename', 'h1', 'Studio'], { fetchImpl })).stdout).toContain('Studio');
    expect((await runCli(['node', 'zcc', 'machine', 'remove', 'h1'], { fetchImpl })).stdout).toContain('removed');
    expect((await runCli(['node', 'zcc', 'machine', 'provider-cli', 'status', 'h1', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'machine', 'provider-cli', 'install', 'h1', 'claude'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'project', 'show', 'p1'], { fetchImpl })).stdout).toContain('App');
    expect((await runCli(['node', 'zcc', 'project', 'files', 'p1', '--json'], { fetchImpl })).stdout).toContain('src/a.ts');
    expect((await runCli(['node', 'zcc', 'project', 'content', 'p1', 'README.md'], { fetchImpl })).stdout).toContain('hello');
    expect((await runCli(['node', 'zcc', 'project', 'skills', 'p1', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'skill', 'show', 'tasks'], { fetchImpl })).stdout).toContain('tasks');
    expect((await runCli(['node', 'zcc', 'skill', 'cli-skills-status', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'skill', 'install-cli-skills', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'settings', 'appearance', 'theme', 'light', '--json'], { fetchImpl })).stdout).toContain('light');
    expect((await runCli(['node', 'zcc', 'terminal', 'send', 's1', '--text', 'ls'], { fetchImpl })).stdout).toContain('ok');
    expect((await runCli(['node', 'zcc', 'environment', 'diff', 'e1', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'environment', 'diff-files', 'e1', '--json'], { fetchImpl })).exitCode).toBe(0);
    expect((await runCli(['node', 'zcc', 'environment', 'pull-request', 'e1', '--json'], { fetchImpl })).exitCode).toBe(0);
  });

  it('returns usage errors for missing ids', async () => {
    const fetchImpl = router({});
    expect((await runCli(['node', 'zcc', 'thread', 'show'], { fetchImpl })).exitCode).toBe(2);
    expect((await runCli(['node', 'zcc', 'thread', 'nope', 'x'], { fetchImpl })).exitCode).toBe(2);
    expect((await runCli(['node', 'zcc', 'machine', 'show'], { fetchImpl })).exitCode).toBe(2);
    expect((await runCli(['node', 'zcc', 'project', 'create'], { fetchImpl })).exitCode).toBe(2);
    expect((await runCli(['node', 'zcc', 'guide', 'nope'])).exitCode).toBe(2);
    expect((await runCli(['node', 'zcc', 'help'])).stdout).toContain('USAGE:');
  });
});
