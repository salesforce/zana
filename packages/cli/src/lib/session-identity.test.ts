import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveCallerIdentity } from './session-identity.js';

function stubEnv(env: Record<string, string | undefined>) {
  for (const key of ['ZCC_PROJECT_ID', 'BB_PROJECT_ID', 'ZCC_THREAD_ID', 'BB_THREAD_ID', 'ZCC_SESSION_ID', 'ZCC_SESSION_TOKEN']) {
    vi.stubEnv(key, env[key]);
  }
}

function fetchReturning(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }));
}

afterEach(() => vi.unstubAllEnvs());

describe('resolveCallerIdentity', () => {
  it('uses the environment without a lookup when both values are present', async () => {
    stubEnv({ ZCC_PROJECT_ID: 'p', ZCC_THREAD_ID: 't', ZCC_SESSION_ID: 's', ZCC_SESSION_TOKEN: 'k' });
    const fetchImpl = fetchReturning(200, {});
    await expect(resolveCallerIdentity({ fetchImpl })).resolves.toEqual({ projectId: 'p', threadId: 't' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('looks the session up when the environment is absent, presenting the session credentials', async () => {
    stubEnv({ ZCC_SESSION_ID: 's', ZCC_SESSION_TOKEN: 'k' });
    const fetchImpl = fetchReturning(200, { sessionId: 's', projectId: 'p', threadId: 't' });
    await expect(resolveCallerIdentity({ fetchImpl, serverUrl: 'http://127.0.0.1:1' })).resolves.toEqual({ projectId: 'p', threadId: 't' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('http://127.0.0.1:1/api/v1/sessions/self');
    expect(init.headers).toMatchObject({ 'x-zcc-caller-session-id': 's', 'x-zcc-caller-credential': 'k' });
  });

  it('lets the environment win and fills only the missing value', async () => {
    stubEnv({ ZCC_PROJECT_ID: 'env-project', ZCC_SESSION_ID: 's', ZCC_SESSION_TOKEN: 'k' });
    const fetchImpl = fetchReturning(200, { projectId: 'other-project', threadId: 't' });
    await expect(resolveCallerIdentity({ fetchImpl })).resolves.toEqual({ projectId: 'env-project', threadId: 't' });
  });

  it('returns project only when the session has no thread', async () => {
    stubEnv({ ZCC_SESSION_ID: 's', ZCC_SESSION_TOKEN: 'k' });
    await expect(resolveCallerIdentity({ fetchImpl: fetchReturning(200, { projectId: 'p' }) })).resolves.toEqual({ projectId: 'p' });
  });

  it('keeps the environment answer when the lookup is refused, unreachable, or malformed', async () => {
    stubEnv({ ZCC_PROJECT_ID: 'p', ZCC_SESSION_ID: 's', ZCC_SESSION_TOKEN: 'k' });
    await expect(resolveCallerIdentity({ fetchImpl: fetchReturning(401, { error: 'invalid session credential' }) })).resolves.toEqual({ projectId: 'p' });
    await expect(resolveCallerIdentity({ fetchImpl: vi.fn(async () => { throw new Error('refused'); }) })).resolves.toEqual({ projectId: 'p' });
    await expect(resolveCallerIdentity({ fetchImpl: fetchReturning(200, { projectId: 5, threadId: {} }) })).resolves.toEqual({ projectId: 'p' });
    await expect(resolveCallerIdentity({ fetchImpl: vi.fn(async () => new Response('null', { status: 200 })) })).resolves.toEqual({ projectId: 'p' });
  });

  it('skips the lookup without a session token or id', async () => {
    const fetchImpl = fetchReturning(200, {});
    stubEnv({ ZCC_SESSION_ID: 's' });
    await expect(resolveCallerIdentity({ fetchImpl })).resolves.toEqual({});
    stubEnv({ ZCC_SESSION_TOKEN: 'k', BB_PROJECT_ID: 'legacy', BB_THREAD_ID: 'legacy-t' });
    await expect(resolveCallerIdentity({ fetchImpl })).resolves.toEqual({ projectId: 'legacy', threadId: 'legacy-t' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
