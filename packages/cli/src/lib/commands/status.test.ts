import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusDashboardHttp } from './status.js';

function server(selfBody: unknown | null) {
  return vi.fn(async (url: URL | string) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/v1/projects') return new Response(JSON.stringify({ projects: [{ id: 'p' }] }));
    if (path === '/api/v1/threads') return new Response(JSON.stringify({ threads: [{ id: 't', status: 'idle', title: 'T', projectId: 'p' }] }));
    if (path === '/api/v1/sessions/self') {
      return selfBody === null ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(selfBody));
    }
    return new Response('{}', { status: 404 });
  });
}

afterEach(() => vi.unstubAllEnvs());

describe('statusDashboardHttp caller identity', () => {
  it('reports the caller project and thread from the session lookup when env is absent', async () => {
    vi.stubEnv('ZCC_PROJECT_ID', undefined);
    vi.stubEnv('ZCC_THREAD_ID', undefined);
    vi.stubEnv('ZCC_SESSION_ID', 's');
    vi.stubEnv('ZCC_SESSION_TOKEN', 'k');
    const result = await statusDashboardHttp(true, { fetchImpl: server({ projectId: 'p', threadId: 't' }) as unknown as typeof fetch });
    expect(JSON.parse(result.stdout)).toMatchObject({ currentProjectId: 'p', currentThreadId: 't' });
  });

  it('falls back to the session id as the current thread when lookup yields none', async () => {
    vi.stubEnv('ZCC_PROJECT_ID', undefined);
    vi.stubEnv('ZCC_THREAD_ID', undefined);
    vi.stubEnv('ZCC_SESSION_ID', 's');
    vi.stubEnv('ZCC_SESSION_TOKEN', 'k');
    const result = await statusDashboardHttp(true, { fetchImpl: server(null) as unknown as typeof fetch });
    expect(JSON.parse(result.stdout)).toMatchObject({ currentProjectId: null, currentThreadId: 's' });
  });

  it('prints the current line in human output', async () => {
    vi.stubEnv('ZCC_PROJECT_ID', 'p');
    vi.stubEnv('ZCC_THREAD_ID', 't');
    vi.stubEnv('ZCC_SESSION_ID', undefined);
    vi.stubEnv('ZCC_SESSION_TOKEN', undefined);
    const result = await statusDashboardHttp(false, { fetchImpl: server(null) as unknown as typeof fetch });
    expect(result.stdout).toContain('Current: t');
  });
});
