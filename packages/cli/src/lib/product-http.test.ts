import { describe, expect, it } from 'vitest';
import { productRequest, resolveServerUrl, renderOrJson } from './product-http.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('product HTTP client', () => {
  it('defaults to loopback 8780', () => {
    expect(resolveServerUrl()).toBe('http://127.0.0.1:8780');
    expect(resolveServerUrl({ serverUrl: 'http://127.0.0.1:9000/' })).toBe('http://127.0.0.1:9000');
  });

  it('maps a connection failure to APP_NOT_RUNNING exit 1', async () => {
    const result = await productRequest('GET', '/api/v1/threads', {
      deps: {
        fetchImpl: async () => {
          throw new Error('fetch failed');
        }
      }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.exitCode).toBe(1);
    expect(result.result.stderr).toMatch(/not running/);
  });

  it('maps 403 FORBIDDEN_AGENT to exit 5', async () => {
    const result = await productRequest('POST', '/api/v1/threads', {
      deps: {
        fetchImpl: async () => jsonResponse(403, { code: 'FORBIDDEN_AGENT', message: 'agents cannot spawn' })
      },
      body: { projectId: 'p', prompt: 'hi' }
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.result.exitCode).toBe(5);
    expect(result.result.stderr).toContain('FORBIDDEN_AGENT');
  });

  it('maps 404 to exit 3 and 400 to exit 2', async () => {
    const missing = await productRequest('GET', '/api/v1/threads/nope', {
      deps: { fetchImpl: async () => jsonResponse(404, { error: 'unknown-thread' }) }
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.result.exitCode).toBe(3);

    const bad = await productRequest('POST', '/api/v1/threads', {
      deps: { fetchImpl: async () => jsonResponse(400, { message: 'path is required' }) },
      body: {}
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.result.exitCode).toBe(2);
  });

  it('passes query params and JSON bodies', async () => {
    let seen = '';
    let method = '';
    let raw = '';
    await productRequest('POST', '/api/v1/threads', {
      query: { projectId: 'p1', empty: undefined },
      body: { prompt: 'hi' },
      deps: {
        fetchImpl: async (input, init) => {
          seen = String(input);
          method = String(init?.method);
          raw = String(init?.body);
          return jsonResponse(201, { thread: { id: 't1' } });
        }
      }
    });
    expect(seen).toContain('/api/v1/threads');
    expect(seen).toContain('projectId=p1');
    expect(seen).not.toContain('empty=');
    expect(method).toBe('POST');
    expect(raw).toContain('"prompt":"hi"');
  });

  it('renderOrJson emits JSON when requested', () => {
    expect(JSON.parse(renderOrJson(true, { a: 1 }, 'nope').stdout)).toEqual({ a: 1 });
    expect(renderOrJson(false, { a: 1 }, 'hello').stdout).toBe('hello\n');
  });
});
