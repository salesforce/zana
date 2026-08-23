import { describe, expect, it, vi } from 'vitest';
import { HostUnavailableError, AmbiguousHostError } from '../../http/host-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { transcribeVoiceOnHost, VoiceTranscriptionError, voiceTranscriptionEnabled } from './voice-transcription.js';
import { VOICE_TRANSCRIPTION_MAX_BYTES } from '../../http/multipart-voice.js';

function ctx(overrides: {
  connected?: string[];
  voiceModel?: string;
  rpc?: ReturnType<typeof vi.fn>;
}): ProductHttpContext {
  const connected = overrides.connected ?? ['host-1'];
  return {
    hostHub: {
      connectedHostIds: () => connected,
      resolveHostId: () => {
        if (connected.length === 0) throw new HostUnavailableError();
        return connected[0]!;
      },
      callHostOnlineRpc: overrides.rpc ?? vi.fn(async () => ({ model: 'gpt-transcribe', text: 'hello' }))
    },
    config: {
      getConfig: () => ({ voiceModel: overrides.voiceModel })
    }
  } as unknown as ProductHttpContext;
}

describe('voice transcription service', () => {
  it('reports enabled only when a host is connected', () => {
    expect(voiceTranscriptionEnabled(ctx({ connected: [] }))).toBe(false);
    expect(voiceTranscriptionEnabled(ctx({ connected: ['h1'] }))).toBe(true);
  });

  it('RPCs the host with base64 audio and returns text', async () => {
    const rpc = vi.fn(async () => ({ model: 'gpt-transcribe', text: 'hello' }));
    await expect(transcribeVoiceOnHost(ctx({ rpc }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm',
      prompt: ' context '
    })).resolves.toBe('hello');
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: 'host-1',
      command: expect.objectContaining({
        type: 'codex.voice.transcribe',
        model: 'gpt-transcribe',
        mimeType: 'audio/webm',
        prompt: 'context'
      })
    }));
  });

  it('rejects empty audio and maps missing Codex auth to 501', async () => {
    await expect(transcribeVoiceOnHost(ctx({}), {
      bytes: Buffer.alloc(0),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 400, code: 'invalid_request' });

    const rpc = vi.fn(async () => {
      throw Object.assign(new Error('missing'), { code: 'codex_auth_missing' });
    });
    await expect(transcribeVoiceOnHost(ctx({ rpc }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toBeInstanceOf(VoiceTranscriptionError);
    await expect(transcribeVoiceOnHost(ctx({ rpc }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({
      status: 501,
      code: 'codex_auth_missing'
    });
  });

  it('maps a disconnected host to 503', async () => {
    await expect(transcribeVoiceOnHost(ctx({ connected: [] }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 503, code: 'host-unavailable' });
  });

  it('rejects oversized audio and uses a configured model', async () => {
    await expect(transcribeVoiceOnHost(ctx({}), {
      bytes: Buffer.alloc(VOICE_TRANSCRIPTION_MAX_BYTES + 1),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 400, code: 'invalid_request' });

    const rpc = vi.fn(async () => ({ model: 'whisper-1', text: 'ok' }));
    await transcribeVoiceOnHost(ctx({ voiceModel: 'whisper-1', rpc }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    });
    expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ model: 'whisper-1' })
    }));
  });

  it('maps remaining host errors', async () => {
    const timeout = vi.fn(async () => {
      throw Object.assign(new Error('slow'), { code: 'codex_request_timeout' });
    });
    await expect(transcribeVoiceOnHost(ctx({ rpc: timeout }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 504, code: 'codex_request_timeout' });

    const limited = vi.fn(async () => {
      throw Object.assign(new Error('slow down'), { code: 'codex_rate_limited' });
    });
    await expect(transcribeVoiceOnHost(ctx({ rpc: limited }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 503, code: 'codex_rate_limited' });

    const down = vi.fn(async () => {
      throw Object.assign(new Error('down'), { code: 'codex_service_unavailable' });
    });
    await expect(transcribeVoiceOnHost(ctx({ rpc: down }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 503 });

    const invalid = vi.fn(async () => {
      throw Object.assign(new Error('bad'), { code: 'codex_auth_invalid' });
    });
    await expect(transcribeVoiceOnHost(ctx({ rpc: invalid }), {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 501, code: 'codex_auth_invalid' });

    const ambiguous = {
      ...ctx({}),
      hostHub: {
        connectedHostIds: () => ['a', 'b'],
        resolveHostId: () => { throw new AmbiguousHostError(); },
        callHostOnlineRpc: vi.fn()
      }
    } as unknown as ProductHttpContext;
    await expect(transcribeVoiceOnHost(ambiguous, {
      bytes: Buffer.from('audio'),
      mimeType: 'audio/webm',
      filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 409, code: 'ambiguous-host' });
  });
});
