import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVoiceCapture } from './voice-session.js';

class FakeMediaRecorder {
  static isTypeSupported(type: string): boolean {
    return type === 'audio/webm';
  }

  mimeType: string;
  state: 'inactive' | 'recording' = 'inactive';
  onstart: (() => void) | null = null;
  onstop: (() => Promise<void> | void) | null = null;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  emitChunks = true;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }

  start(): void {
    this.state = 'recording';
    this.onstart?.();
  }

  stop(): void {
    this.state = 'inactive';
    if (this.emitChunks) {
      this.ondataavailable?.({ data: new Blob(['abc'], { type: this.mimeType }) });
    }
    void this.onstop?.();
  }
}

function fakeStream(): MediaStream {
  const stop = vi.fn();
  return {
    getTracks: () => [{ stop }],
    getAudioTracks: () => []
  } as unknown as MediaStream;
}

describe('voice capture session', () => {
  const previousRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;

  afterEach(() => {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = previousRecorder;
  });

  function installRecorder(): typeof FakeMediaRecorder {
    (globalThis as unknown as { MediaRecorder: typeof FakeMediaRecorder }).MediaRecorder = FakeMediaRecorder;
    return FakeMediaRecorder;
  }

  it('starts, confirms, and inserts a transcript', async () => {
    installRecorder();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const states: string[] = [];
    let now = 0;
    const session = createVoiceCapture(
      {
        now: () => now,
        ensureMicAccess: async () => true,
        getUserMedia: async () => fakeStream(),
        transcribe: async () => ({ ok: true, text: '  hello   world  ' })
      },
      {
        onState: (state) => { states.push(state); },
        onStream: () => undefined,
        onTranscript,
        onError
      }
    );
    now = 0;
    await session.start();
    expect(states).toContain('recording');
    now = 1500;
    session.stop();
    await vi.waitFor(() => expect(onTranscript).toHaveBeenCalledWith('hello world'));
    expect(onError).not.toHaveBeenCalled();
    expect(states.at(-1)).toBe('idle');
    session.dispose();
  });

  it('cancels a recording without transcribing', async () => {
    installRecorder();
    const transcribe = vi.fn(async () => ({ ok: true, text: 'nope' }));
    const onTranscript = vi.fn();
    const states: string[] = [];
    let now = 0;
    const session = createVoiceCapture(
      {
        now: () => now,
        ensureMicAccess: async () => true,
        getUserMedia: async () => fakeStream(),
        transcribe
      },
      {
        onState: (state) => { states.push(state); },
        onStream: () => undefined,
        onTranscript,
        onError: () => undefined
      }
    );
    now = 0;
    await session.start();
    now = 1500;
    session.cancel();
    await vi.waitFor(() => expect(states.at(-1)).toBe('idle'));
    expect(transcribe).not.toHaveBeenCalled();
    expect(onTranscript).not.toHaveBeenCalled();
    session.dispose();
  });

  it('rejects a clip shorter than one second', async () => {
    installRecorder();
    const onError = vi.fn();
    let now = 0;
    const session = createVoiceCapture(
      {
        now: () => now,
        ensureMicAccess: async () => true,
        getUserMedia: async () => fakeStream(),
        transcribe: async () => ({ ok: true, text: 'hello' })
      },
      {
        onState: () => undefined,
        onStream: () => undefined,
        onTranscript: () => undefined,
        onError
      }
    );
    now = 0;
    await session.start();
    now = 200;
    session.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Recording too short (minimum 1 second)'));
    session.dispose();
  });

  it('aborts an in-flight transcription', async () => {
    installRecorder();
    let finish: ((value: { ok: boolean; text: string }) => void) | undefined;
    const onTranscript = vi.fn();
    const states: string[] = [];
    let now = 0;
    const session = createVoiceCapture(
      {
        now: () => now,
        ensureMicAccess: async () => true,
        getUserMedia: async () => fakeStream(),
        transcribe: () => new Promise((resolve) => { finish = resolve; })
      },
      {
        onState: (state) => { states.push(state); },
        onStream: () => undefined,
        onTranscript,
        onError: () => undefined
      }
    );
    now = 0;
    await session.start();
    now = 1500;
    session.stop();
    await vi.waitFor(() => expect(states).toContain('transcribing'));
    session.cancel();
    finish?.({ ok: true, text: 'late' });
    await vi.waitFor(() => expect(states.at(-1)).toBe('idle'));
    expect(onTranscript).not.toHaveBeenCalled();
    session.dispose();
  });

  it('maps a missing microphone permission', async () => {
    installRecorder();
    const onError = vi.fn();
    const session = createVoiceCapture(
      {
        ensureMicAccess: async () => false,
        getUserMedia: async () => fakeStream(),
        transcribe: async () => ({ ok: true, text: 'x' })
      },
      {
        onState: () => undefined,
        onStream: () => undefined,
        onTranscript: () => undefined,
        onError
      }
    );
    await session.start();
    expect(onError.mock.calls[0]?.[0]).toMatch(/Microphone access is off/);
    session.dispose();
  });

  it('reports empty capture when no chunks arrive', async () => {
    class EmptyRecorder extends FakeMediaRecorder {
      stop(): void {
        this.state = 'inactive';
        void this.onstop?.();
      }
    }
    (globalThis as unknown as { MediaRecorder: typeof EmptyRecorder }).MediaRecorder = EmptyRecorder;
    EmptyRecorder.isTypeSupported = FakeMediaRecorder.isTypeSupported;
    const onError = vi.fn();
    let now = 0;
    const session = createVoiceCapture(
      {
        now: () => now,
        ensureMicAccess: async () => true,
        getUserMedia: async () => fakeStream(),
        transcribe: async () => ({ ok: true, text: 'x' })
      },
      {
        onState: () => undefined,
        onStream: () => undefined,
        onTranscript: () => undefined,
        onError
      }
    );
    now = 0;
    await session.start();
    now = 1500;
    session.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('No audio was captured'));
    session.dispose();
  });

  it('surfaces a failed transcription and a getUserMedia error', async () => {
    installRecorder();
    const onError = vi.fn();
    let now = 0;
    const failing = createVoiceCapture(
      {
        now: () => now,
        ensureMicAccess: async () => true,
        getUserMedia: async () => fakeStream(),
        transcribe: async () => ({ ok: false, text: '', error: 'Sign in with Codex' })
      },
      {
        onState: () => undefined,
        onStream: () => undefined,
        onTranscript: () => undefined,
        onError
      }
    );
    now = 0;
    await failing.start();
    now = 1500;
    failing.stop();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Sign in with Codex'));
    failing.dispose();

    const micError = createVoiceCapture(
      {
        ensureMicAccess: async () => true,
        getUserMedia: async () => { throw new DOMException('denied', 'NotAllowedError'); },
        transcribe: async () => ({ ok: true, text: 'x' })
      },
      {
        onState: () => undefined,
        onStream: () => undefined,
        onTranscript: () => undefined,
        onError
      }
    );
    onError.mockClear();
    await micError.start();
    expect(onError).toHaveBeenCalledWith('Microphone permission denied');
    micError.dispose();
  });
});
