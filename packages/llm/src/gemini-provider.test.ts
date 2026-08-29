import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GeminiProvider } from './gemini-provider.js';

function okResponse(text: string, usage?: { promptTokenCount?: number; candidatesTokenCount?: number }) {
  return {
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: usage
    })
  } as Response;
}

describe('GeminiProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns ok:false without fetching when no key is configured', async () => {
    const provider = new GeminiProvider(() => null);
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no Gemini API key/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves candidate text and usage on success', async () => {
    const provider = new GeminiProvider(() => 'key');
    fetchMock.mockResolvedValueOnce(okResponse(' hi ', { promptTokenCount: 5, candidatesTokenCount: 2 }));
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('hi');
    expect(result.usage).toEqual({ inputTokens: 5, outputTokens: 2 });
  });

  it('maps a Claude tier alias to a Gemini model in the URL and sends the key in the header', async () => {
    const provider = new GeminiProvider(() => 'secret-key');
    fetchMock.mockResolvedValueOnce(okResponse('x'));
    const result = await provider.run({ system: 's', user: 'u', model: 'haiku' });
    const url = fetchMock.mock.calls[0][0] as string;
    const opts = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
    expect(url).toContain('gemini-2.0-flash:generateContent');
    expect(url).not.toContain('secret-key');
    expect(opts.headers['x-goog-api-key']).toBe('secret-key');
    expect(result.model).toBe('gemini-2.0-flash');
  });

  it('carries the system prompt in system_instruction when present', async () => {
    const provider = new GeminiProvider(() => 'key');
    fetchMock.mockResolvedValueOnce(okResponse('x'));
    await provider.run({ system: 'be terse', user: 'u' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.system_instruction).toEqual({ parts: [{ text: 'be terse' }] });
  });

  it('omits system_instruction when the system prompt is blank', async () => {
    const provider = new GeminiProvider(() => 'key');
    fetchMock.mockResolvedValueOnce(okResponse('x'));
    await provider.run({ system: '  ', user: 'u' });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.system_instruction).toBeUndefined();
  });

  it('returns ok:false on an HTTP error', async () => {
    const provider = new GeminiProvider(() => 'key');
    fetchMock.mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'rate limited' } as Response);
    const result = await provider.run({ system: 's', user: 'u' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('429');
  });
});
