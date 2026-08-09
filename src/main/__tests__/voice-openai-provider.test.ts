import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OpenAiVoiceProvider } from '../voice/openai-provider.js';

describe('OpenAiVoiceProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns error when no API key is configured', async () => {
    const provider = new OpenAiVoiceProvider(() => null);
    const result = await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No OpenAI API key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns error when audio exceeds size limit', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    const largeBuffer = Buffer.alloc(26 * 1024 * 1024);
    const result = await provider.transcribe({
      audio: largeBuffer,
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('too large');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves on successful transcription', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello world' })
    } as Response);

    const result = await provider.transcribe({
      audio: Buffer.from('fake audio'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('hello world');
    expect(result.ms).toBeGreaterThanOrEqual(0);
  });

  it('resolves on network error', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockRejectedValueOnce(new Error('Network failure'));

    const result = await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('resolves on HTTP error response', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    } as Response);

    const result = await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('401');
  });

  it('includes language in form data when provided', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'bonjour' })
    } as Response);

    const result = await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm;codecs=opus',
      language: 'fr'
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('bonjour');
    const callBody = fetchMock.mock.calls[0][1].body as Buffer;
    expect(callBody.toString()).toContain('language');
    expect(callBody.toString()).toContain('fr');
  });

  it('uses the provided model instead of whisper-1', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello' })
    } as Response);

    await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      model: 'gpt-4o-transcribe'
    });

    const callBody = fetchMock.mock.calls[0][1].body as Buffer;
    expect(callBody.toString()).toContain('gpt-4o-transcribe');
    expect(callBody.toString()).not.toContain('whisper-1');
  });

  it('defaults to whisper-1 when no model is provided', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello' })
    } as Response);

    await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    const callBody = fetchMock.mock.calls[0][1].body as Buffer;
    expect(callBody.toString()).toContain('whisper-1');
  });

  it('omits language field when not provided', async () => {
    const provider = new OpenAiVoiceProvider(() => 'sk-test');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: 'hello' })
    } as Response);

    await provider.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    const callBody = fetchMock.mock.calls[0][1].body as Buffer;
    const bodyStr = callBody.toString();
    expect(bodyStr).not.toContain('name="language"');
  });
});
