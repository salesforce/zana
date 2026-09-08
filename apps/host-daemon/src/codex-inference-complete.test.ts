import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetChatGptCloudflareCookiesForTests } from './chatgpt-cloudflare-cookies.js';
import { completeCodexInference } from './codex-inference-complete.js';

function jwtPayload(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

function writeChatGptAuth(homeDir: string): string {
  const accessToken = jwtPayload({
    'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' }
  });
  mkdirSync(join(homeDir, '.codex'), { recursive: true });
  writeFileSync(join(homeDir, '.codex', 'auth.json'), JSON.stringify({
    auth_mode: 'chatgpt',
    tokens: { access_token: accessToken, account_id: 'acct_1' }
  }));
  return accessToken;
}

function command(overrides: Partial<Parameters<typeof completeCodexInference>[0]> = {}) {
  return {
    type: 'codex.inference.complete' as const,
    model: 'gpt-5',
    reasoningEffort: 'none' as const,
    prompt: 'Name this thread.',
    outputSchema: { type: 'object', properties: { title: { type: 'string' } } },
    timeoutMs: 10_000,
    ...overrides
  };
}

function sseBody(text: string): string {
  return [
    `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}`,
    '',
    `data: ${JSON.stringify({
      type: 'response.completed',
      response: { output: [{ content: [{ type: 'output_text', text }] }] }
    })}`,
    '',
    ''
  ].join('\n');
}

afterEach(() => {
  resetChatGptCloudflareCookiesForTests();
});

describe('codex inference complete', () => {
  it('posts ChatGPT structured inference with Codex tokens', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-infer-cg-'));
    const accessToken = writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(sseBody('{"title":"Hello"}'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));
    await expect(completeCodexInference(command(), { homeDir, fetchImpl })).resolves.toEqual({
      model: 'gpt-5',
      value: { title: 'Hello' }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`);
    expect(headers.get('chatgpt-account-id')).toBe('acct_1');
    const body = JSON.parse(String((init as RequestInit).body)) as { model: string; stream: boolean };
    expect(body).toMatchObject({ model: 'gpt-5', stream: true });
  });

  it('maps unauthorized ChatGPT responses to auth-required', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-infer-401-'));
    writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(completeCodexInference(command(), { homeDir, fetchImpl })).rejects.toMatchObject({
      code: 'codex_auth_failed'
    });
  });

  it('requires Codex credentials before fetch', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-infer-missing-'));
    const fetchImpl = vi.fn();
    await expect(completeCodexInference(command(), { homeDir, fetchImpl })).rejects.toMatchObject({
      code: 'codex_auth_missing'
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('posts OpenAI structured inference when Codex stores an API key', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-infer-key-'));
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    writeFileSync(join(homeDir, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-codex-api-key'
    }));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(sseBody('{"title":"Keyed"}'), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' }
    }));
    await expect(completeCodexInference(command(), { homeDir, fetchImpl })).resolves.toEqual({
      model: 'gpt-5',
      value: { title: 'Keyed' }
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe('Bearer sk-codex-api-key');
  });

  it('retries ChatGPT inference after a Cloudflare challenge cookie', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-infer-cf-'));
    writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('challenge', {
        status: 403,
        headers: {
          'cf-mitigated': 'challenge',
          'set-cookie': '__cf_bm=cloudflare-cookie; Path=/; Secure; HttpOnly'
        }
      }))
      .mockResolvedValueOnce(new Response(sseBody('{"title":"Retry"}'), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      }));
    await expect(completeCodexInference(command(), { homeDir, fetchImpl })).resolves.toEqual({
      model: 'gpt-5',
      value: { title: 'Retry' }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const retryHeaders = new Headers((fetchImpl.mock.calls[1]![1] as RequestInit).headers);
    expect(retryHeaders.get('cookie')).toBe('__cf_bm=cloudflare-cookie');
  });
});
