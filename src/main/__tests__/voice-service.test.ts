import { describe, it, expect, vi } from 'vitest';
import { VoiceService } from '../voice-service.js';
import type { VoiceProvider } from '../voice/provider.js';
import type { VoiceTranscribeResult } from '../../shared/types.js';

function fakeProvider(result: Partial<VoiceTranscribeResult> = {}): VoiceProvider {
  return {
    id: 'openai',
    transcribe: vi.fn(async () => ({
      ok: true,
      text: 'transcribed',
      ms: 10,
      ...result
    }))
  };
}

describe('VoiceService', () => {
  it('forwards the request to the registered provider', async () => {
    const provider = fakeProvider({ text: 'hello world' });
    const svc = new VoiceService(new Map([['openai', provider]]));

    const result = await svc.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('hello world');
    expect(provider.transcribe).toHaveBeenCalledTimes(1);
  });

  it('returns ok:false when the provider is missing', async () => {
    const svc = new VoiceService(new Map());
    const result = await svc.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('openai');
  });

  it('setProvider registers a new provider', async () => {
    const svc = new VoiceService(new Map());
    const provider = fakeProvider({ text: 'late register' });
    svc.setProvider(provider);

    const result = await svc.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('late register');
  });

  it('forwards model and language to the provider', async () => {
    const provider = fakeProvider();
    const svc = new VoiceService(new Map([['openai', provider]]));

    await svc.transcribe({
      audio: Buffer.from('fake'),
      mimeType: 'audio/webm',
      model: 'gpt-4o-transcribe',
      language: 'en'
    });

    expect(provider.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-transcribe', language: 'en' })
    );
  });
});
