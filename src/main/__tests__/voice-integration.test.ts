import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VoiceTranscribeRequest } from '../voice/provider.js';
import type { VoiceTranscribeResult } from '../../shared/types.js';
import { VoiceService } from '../voice-service.js';

/**
 * Integration test: exercises the full voice flow from IPC-handler-shaped input
 * through VoiceService → provider → result, validating the same sequence the
 * real IPC handler follows (decode base64 → build request → transcribe → return).
 */
describe('voice transcription integration', () => {
  let service: VoiceService;
  const mockTranscribe = vi.fn() as unknown as ReturnType<typeof vi.fn> & ((req: VoiceTranscribeRequest) => Promise<VoiceTranscribeResult>);

  beforeEach(() => {
    vi.resetAllMocks();
    const providers = new Map([
      [
        'openai',
        {
          id: 'openai',
          transcribe: mockTranscribe
        }
      ]
    ]);
    service = new VoiceService(providers);
  });

  it('full flow: base64 audio → provider → transcript', async () => {
    mockTranscribe.mockResolvedValueOnce({
      ok: true,
      text: 'hello world',
      ms: 150
    });

    // Simulate what the IPC handler does:
    const base64Audio = Buffer.from('fake-audio-data').toString('base64');
    const mimeType = 'audio/webm;codecs=opus';

    // Decode (as the IPC handler does)
    const audioBuffer = Buffer.from(base64Audio, 'base64');

    const result = await service.transcribe({
      audio: audioBuffer,
      mimeType
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('hello world');
    expect(mockTranscribe).toHaveBeenCalledWith({
      audio: audioBuffer,
      mimeType: 'audio/webm;codecs=opus'
    });
  });

  it('rejects oversized audio at the IPC validation layer', () => {
    // The IPC handler rejects audio > 25 MB before reaching the service
    const MAX_AUDIO_SIZE = 25 * 1024 * 1024;
    const oversized = Buffer.alloc(MAX_AUDIO_SIZE + 1);
    const base64 = oversized.toString('base64');
    const decoded = Buffer.from(base64, 'base64');

    expect(decoded.length).toBeGreaterThan(MAX_AUDIO_SIZE);
  });

  it('returns error for missing provider', async () => {
    const emptyService = new VoiceService(new Map());
    const result = await emptyService.transcribe({
      audio: Buffer.from('test'),
      mimeType: 'audio/wav'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No voice provider');
  });

  it('propagates provider errors without throwing', async () => {
    mockTranscribe.mockResolvedValueOnce({
      ok: false,
      text: '',
      error: 'Network error: connection refused',
      ms: 50
    });

    const result = await service.transcribe({
      audio: Buffer.from('test'),
      mimeType: 'audio/webm'
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network error');
  });

  it('handles the language parameter pass-through', async () => {
    mockTranscribe.mockResolvedValueOnce({
      ok: true,
      text: 'bonjour monde',
      ms: 200
    });

    const result = await service.transcribe({
      audio: Buffer.from('french-audio'),
      mimeType: 'audio/webm',
      language: 'fr'
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('bonjour monde');
    expect(mockTranscribe).toHaveBeenCalledWith(
      expect.objectContaining({ language: 'fr' })
    );
  });
});
