import {
  CHUNK_TIMESLICE_MS,
  createRecordingFile,
  fileToBase64,
  MIN_RECORDING_DURATION_MS,
  normalizeTranscript,
  resolvePreferredAudioMimeType,
  resolveRecordingErrorMessage,
  type VoiceInputState
} from './voice-helpers.js';

export interface VoiceCaptureHost {
  ensureMicAccess: () => Promise<boolean>;
  transcribe: (audio: string, mimeType: string) => Promise<{ ok: boolean; text: string; error?: string }>;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  now?: () => number;
}

export interface VoiceCaptureCallbacks {
  onState: (state: VoiceInputState) => void;
  onStream: (stream: MediaStream | null) => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
}

export interface VoiceCaptureSession {
  start: () => Promise<void>;
  stop: () => void;
  cancel: () => void;
  dispose: () => void;
}

export function createVoiceCapture(
  host: VoiceCaptureHost,
  callbacks: VoiceCaptureCallbacks
): VoiceCaptureSession {
  const now = host.now ?? (() => Date.now());
  let mediaRecorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let startedAtMs: number | null = null;
  let shouldTranscribe = true;
  let transcriptionAbort: AbortController | null = null;
  let state: VoiceInputState = 'idle';

  const setState = (next: VoiceInputState) => {
    state = next;
    callbacks.onState(next);
  };

  const fail = (message: string) => {
    setState('error');
    callbacks.onError(message);
  };

  const stopMediaStream = () => {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
    callbacks.onStream(null);
  };

  const start = async () => {
    if (state === 'recording' || state === 'transcribing') return;
    const micOk = await host.ensureMicAccess().catch(() => true);
    if (!micOk) {
      fail('Microphone access is off. Enable it for the app in System Settings › Privacy › Microphone.');
      return;
    }
    try {
      const nextStream = await host.getUserMedia({ audio: true });
      stream = nextStream;
      callbacks.onStream(nextStream);
      chunks = [];
      startedAtMs = now();
      shouldTranscribe = true;
      const preferredMimeType = resolvePreferredAudioMimeType();
      const recorder = preferredMimeType
        ? new MediaRecorder(nextStream, { mimeType: preferredMimeType })
        : new MediaRecorder(nextStream);
      mediaRecorder = recorder;
      recorder.onstart = () => setState('recording');
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onerror = () => fail('Voice recording failed');
      recorder.onstop = async () => {
        stopMediaStream();
        if (!shouldTranscribe) {
          shouldTranscribe = true;
          chunks = [];
          setState('idle');
          return;
        }
        const durationMs = now() - (startedAtMs ?? now());
        startedAtMs = null;
        if (durationMs < MIN_RECORDING_DURATION_MS) {
          fail('Recording too short (minimum 1 second)');
          chunks = [];
          return;
        }
        const recorded = chunks;
        chunks = [];
        if (recorded.length === 0) {
          fail('No audio was captured');
          return;
        }
        const recordedMimeType = recorder.mimeType || preferredMimeType || 'audio/webm';
        const audioFile = createRecordingFile(new Blob(recorded, { type: recordedMimeType }), recordedMimeType);
        setState('transcribing');
        const abort = new AbortController();
        transcriptionAbort = abort;
        try {
          const base64 = await fileToBase64(audioFile);
          if (abort.signal.aborted) {
            setState('idle');
            return;
          }
          const result = await host.transcribe(base64, recordedMimeType);
          if (abort.signal.aborted) {
            setState('idle');
            return;
          }
          const normalized = normalizeTranscript(result.ok ? result.text : '');
          if (!result.ok || normalized.length === 0) {
            throw new Error(result.error || 'Voice transcription returned an empty result.');
          }
          callbacks.onTranscript(normalized);
          setState('idle');
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setState('idle');
            return;
          }
          fail(resolveRecordingErrorMessage(error));
        } finally {
          if (transcriptionAbort === abort) transcriptionAbort = null;
        }
      };
      recorder.start(CHUNK_TIMESLICE_MS);
    } catch (error) {
      stopMediaStream();
      mediaRecorder = null;
      chunks = [];
      startedAtMs = null;
      fail(resolveRecordingErrorMessage(error));
    }
  };

  const stop = () => {
    if (state !== 'recording') return;
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    shouldTranscribe = true;
    try {
      mediaRecorder.stop();
    } catch (error) {
      fail(resolveRecordingErrorMessage(error));
    }
  };

  const cancel = () => {
    if (state === 'recording') {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        shouldTranscribe = false;
        try {
          mediaRecorder.stop();
        } catch (error) {
          fail(resolveRecordingErrorMessage(error));
        }
      }
      return;
    }
    if (state === 'transcribing') {
      transcriptionAbort?.abort();
      transcriptionAbort = null;
      setState('idle');
    }
  };

  const dispose = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch { /* ignore */ }
    }
    mediaRecorder = null;
    chunks = [];
    startedAtMs = null;
    shouldTranscribe = true;
    transcriptionAbort?.abort();
    transcriptionAbort = null;
    stopMediaStream();
  };

  return { start, stop, cancel, dispose };
}
