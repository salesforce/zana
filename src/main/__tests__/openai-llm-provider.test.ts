import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiProvider } from '../llm/openai-provider.js';

function okResponse(content: string, usage?: { prompt_tokens?: number; completion_tokens?: number }) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }], usage })
  } as Response;
}

describe('OpenAiProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:false without fetching when no key is configured', async () => {
    const provider = new OpenAiProvider(() => null);
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no OpenAI API key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not fetch when the signal is already aborted', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    const controller = new AbortController();
    controller.abort();
    const result = await provider.run({ system: 's', user: 'u', signal: controller.signal });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/abort/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves the message content and token usage on success', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce(okResponse(' hello world ', { prompt_tokens: 12, completion_tokens: 3 }));
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('hello world');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it('maps a Claude tier alias to a concrete OpenAI model in the request body', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce(okResponse('x'));
    const result = await provider.run({ system: 's', user: 'u', model: 'haiku' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(result.model).toBe('gpt-4o-mini');
  });

  it('omits the system message when the system prompt is blank', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce(okResponse('x'));
    await provider.run({ system: '   ', user: 'u' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.messages).toEqual([{ role: 'user', content: 'u' }]);
  });

  it('returns ok:false on an HTTP error', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' } as Response);
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('returns ok:false on a network error', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    fetchMock.mockRejectedValueOnce(new Error('boom'));
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
  });

  it('reports an abort distinctly from a timeout', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url, opts: { signal: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          reject(e);
        });
      });
    });
    const p = provider.run({ system: 's', user: 'u', signal: controller.signal });
    controller.abort();
    const result = await p;
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/abort/i);
  });

  it('clamps returned text to maxOutputChars', async () => {
    const provider = new OpenAiProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce(okResponse('abcdefghij'));
    const result = await provider.run({ system: 's', user: 'u', maxOutputChars: 4 });
    expect(result.text).toBe('abcd');
  });
});
