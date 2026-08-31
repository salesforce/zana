import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetChatGptCloudflareCookiesForTests } from './chatgpt-cloudflare-cookies.js';
import { transcribeCodexVoice, VOICE_TRANSCRIPTION_MAX_BYTES } from './codex-voice-transcribe.js';

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

function command(overrides: Partial<Parameters<typeof transcribeCodexVoice>[0]> = {}) {
  return {
    type: 'codex.voice.transcribe' as const,
    model: 'gpt-transcribe',
    audioBase64: Buffer.from('audio').toString('base64'),
    mimeType: 'audio/webm',
    filename: 'recording.webm',
    prompt: null,
    timeoutMs: 10_000,
    ...overrides
  };
}

afterEach(() => {
  resetChatGptCloudflareCookiesForTests();
});

describe('codex voice transcribe', () => {
  it('posts ChatGPT transcription with Codex tokens', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-cg-'));
    const accessToken = writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ text: 'hello world' }), { status: 200 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl })).resolves.toEqual({
      model: 'gpt-transcribe',
      text: 'hello world'
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://chatgpt.com/backend-api/transcribe');
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`);
    expect(headers.get('chatgpt-account-id')).toBe('acct_1');
    expect(headers.get('originator')).toBe('zcc');
  });

  it('retries ChatGPT transcription after a Cloudflare challenge cookie', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-cf-'));
    writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('challenge', {
        status: 403,
        headers: {
          'cf-mitigated': 'challenge',
          'set-cookie': '__cf_bm=cloudflare-cookie; Path=/; Secure; HttpOnly'
        }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: 'retry' }), { status: 200 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl })).resolves.toEqual({
      model: 'gpt-transcribe',
      text: 'retry'
    });
    const retryHeaders = new Headers((fetchImpl.mock.calls[1]![1] as RequestInit).headers);
    expect(retryHeaders.get('cookie')).toBe('__cf_bm=cloudflare-cookie');
  });

  it('posts OpenAI transcriptions when Codex stores an API key', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-key-'));
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    writeFileSync(join(homeDir, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-codex-api-key'
    }));
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ text: 'hello openai' }), { status: 200 }));
    await expect(transcribeCodexVoice(command({ prompt: 'context' }), { homeDir, fetchImpl })).resolves.toEqual({
      model: 'gpt-transcribe',
      text: 'hello openai'
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions');
    expect(new Headers((init as RequestInit).headers).get('authorization')).toBe('Bearer sk-codex-api-key');
  });

  it('maps ChatGPT rate limits to a host error', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-429-'));
    writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      detail: { detail: 'Transcription is temporarily unavailable. Please try again later.' }
    }), { status: 429 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl })).rejects.toMatchObject({
      code: 'codex_rate_limited',
      message: expect.stringContaining('try again later')
    });
  });

  it('maps unauthorized ChatGPT responses', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-401-'));
    writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl })).rejects.toMatchObject({
      code: 'codex_auth_failed'
    });
    const serverError = vi.fn(async () => new Response('down', { status: 503 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl: serverError })).rejects.toMatchObject({
      code: 'codex_service_unavailable'
    });
  });

  it('rejects empty and oversized audio before fetch', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-size-'));
    writeChatGptAuth(homeDir);
    const fetchImpl = vi.fn();
    await expect(transcribeCodexVoice(command({ audioBase64: '' }), { homeDir, fetchImpl })).rejects.toMatchObject({
      code: 'invalid_request'
    });
    const huge = Buffer.alloc(VOICE_TRANSCRIPTION_MAX_BYTES + 1).toString('base64');
    await expect(transcribeCodexVoice(command({ audioBase64: huge }), { homeDir, fetchImpl })).rejects.toMatchObject({
      code: 'invalid_request'
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects an oversized transcription payload', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-big-'));
    mkdirSync(join(homeDir, '.codex'), { recursive: true });
    writeFileSync(join(homeDir, '.codex', 'auth.json'), JSON.stringify({
      auth_mode: 'apikey',
      OPENAI_API_KEY: 'sk-codex-api-key'
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: 'x'.repeat(1024 * 1024) }), { status: 200 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl })).rejects.toMatchObject({
      code: 'codex_response_too_large'
    });
  });

  it('rejects invalid or textless transcription JSON', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'zcc-voice-json-'));
    writeChatGptAuth(homeDir);
    const invalid = vi.fn(async () => new Response('not-json', { status: 200 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl: invalid })).rejects.toMatchObject({
      code: 'codex_response_invalid'
    });
    const missing = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(transcribeCodexVoice(command(), { homeDir, fetchImpl: missing })).rejects.toMatchObject({
      code: 'codex_response_invalid'
    });
  });
});
