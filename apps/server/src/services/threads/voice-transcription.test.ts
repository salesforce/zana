import { describe, expect, it, vi } from 'vitest';
import { HostRpcCommandSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { HostUnavailableError, AmbiguousHostError } from '../../http/host-hub.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { transcribeVoiceOnHost, VoiceTranscriptionError, voiceTranscriptionStatus } from './voice-transcription.js';
import { VOICE_TRANSCRIPTION_MAX_BYTES } from '../../http/multipart-voice.js';

function ctx(overrides: {
  connected?: string[];
  voiceModel?: string;
  voiceInputEnabled?: boolean;
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
      getConfig: () => ({ voiceModel: overrides.voiceModel, voiceInputEnabled: overrides.voiceInputEnabled ?? true })
    }
  } as unknown as ProductHttpContext;
}

describe('voice transcription service', () => {
  it('preserves Keychain access guidance instead of asking an already signed-in user to sign in', async () => {
    const rpc = vi.fn(async () => {
      throw Object.assign(new Error('Unlock Keychain on your Mac, then try again.'), { code: 'codex_keyring_unavailable' });
    });
    await expect(transcribeVoiceOnHost(ctx({ rpc }), {
      bytes: Buffer.from('audio'), mimeType: 'audio/mp4', filename: 'recording.mp4'
    })).rejects.toMatchObject({ status: 503, code: 'codex_keyring_unavailable', message: 'Unlock Keychain on your Mac, then try again.' });
  });
  describe('voiceTranscriptionStatus', () => {
    const status = (rpc?: ReturnType<typeof vi.fn>, connected?: string[]) => voiceTranscriptionStatus(ctx({ rpc, connected }));

    it('reports no_host without calling the host when none is connected', async () => {
      const rpc = vi.fn();
      await expect(status(rpc, [])).resolves.toEqual({ enabled: false, reason: 'no_host' });
      expect(rpc).not.toHaveBeenCalled();
    });

    it('reports disabled without touching the host when dictation is off', async () => {
      const rpc = vi.fn();
      await expect(voiceTranscriptionStatus(ctx({ rpc, voiceInputEnabled: false })))
        .resolves.toEqual({ enabled: false, reason: 'disabled' });
      expect(rpc).not.toHaveBeenCalled();
    });

    it('reports ambiguous_host when several computers are connected', async () => {
      const ambiguous = {
        hostHub: {
          connectedHostIds: () => ['a', 'b'],
          resolveHostId: () => { throw new AmbiguousHostError(); },
          callHostOnlineRpc: vi.fn()
        },
        config: { getConfig: () => ({ voiceInputEnabled: true }) }
      } as unknown as ProductHttpContext;
      await expect(voiceTranscriptionStatus(ambiguous)).resolves.toEqual({ enabled: false, reason: 'ambiguous_host' });
    });

    it('probes the host with codex.voice.status', async () => {
      const rpc = vi.fn(async () => ({ state: 'ready' }));
      await expect(status(rpc)).resolves.toEqual({ enabled: true, reason: null });
      expect(rpc).toHaveBeenCalledWith(expect.objectContaining({
        hostId: 'host-1', command: { type: 'codex.voice.status' }
      }));
      expect(HostRpcCommandSchema.safeParse({ type: 'codex.voice.status' }).success).toBe(true);
    });

    it('disables only when the host reports missing credentials', async () => {
      await expect(status(vi.fn(async () => ({ state: 'missing' })))).resolves.toEqual({ enabled: false, reason: 'auth_missing' });
      await expect(status(vi.fn(async () => ({ state: 'unverified' })))).resolves.toEqual({ enabled: true, reason: null });
    });

    it('stays enabled when the probe fails or returns an unknown shape (older host)', async () => {
      await expect(status(vi.fn(async () => { throw new Error('unknown command'); }))).resolves.toEqual({ enabled: true, reason: null });
      await expect(status(vi.fn(async () => ({ model: 'x', text: 'y' })))).resolves.toEqual({ enabled: true, reason: null });
    });
  });

  it('refuses with 403 voice_disabled when dictation is off, before touching the host', async () => {
    const rpc = vi.fn();
    await expect(transcribeVoiceOnHost(ctx({ rpc, voiceInputEnabled: false }), {
      bytes: Buffer.from('audio'), mimeType: 'audio/webm', filename: 'recording.webm'
    })).rejects.toMatchObject({ status: 403, code: 'voice_disabled' });
    expect(rpc).not.toHaveBeenCalled();
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

  it('sends a schema-valid command with time for the RPC to return its result', async () => {
    const rpc = vi.fn(async ({ command, timeoutMs }) => {
      const parsed = HostRpcCommandSchema.parse(command);
      expect(parsed.type).toBe('codex.voice.transcribe');
      expect(timeoutMs).toBeGreaterThan(command.timeoutMs);
      return { model: command.model, text: 'transcribed' };
    });
    await expect(transcribeVoiceOnHost(ctx({ rpc }), {
      bytes: Buffer.from('audio'), mimeType: 'audio/mp4', filename: 'recording.mp4'
    })).resolves.toBe('transcribed');
    expect(rpc).toHaveBeenCalledOnce();
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
