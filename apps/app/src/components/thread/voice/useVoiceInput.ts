import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { useUi } from '../../../store.js';
import { createVoiceCapture, type VoiceCaptureSession } from './voice-session.js';
import { voiceStartBlockReason, type VoiceInputState } from './voice-helpers.js';

interface CaptureEntry {
  state: VoiceInputState;
  stream: MediaStream | null;
  session: VoiceCaptureSession;
  transcript: (text: string) => void | Promise<void>;
  listeners: Set<() => void>;
}
const captures = new Map<string, CaptureEntry>();

export interface UseVoiceInputOptions {
  onTranscript: (text: string) => void | Promise<void>;
  enabled?: boolean;
  ownerKey?: string;
}

export function useVoiceInput({ onTranscript, enabled = true, ownerKey }: UseVoiceInputOptions) {
  const pushToast = useUi((s) => s.pushToast);
  const sessionRef = useRef<VoiceCaptureSession | null>(null);
  const [state, setState] = useState<VoiceInputState>('idle');
  const [isSupported] = useState(() => {
    const hasMediaDevices = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
    return hasMediaDevices && typeof MediaRecorder !== 'undefined';
  });
  const [available, setAvailable] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);

  const showError = useCallback((message: string) => {
    setState('error');
    pushToast(message, 'error');
  }, [pushToast]);

  useEffect(() => {
    if (!enabled) {
      setAvailable(false);
      return;
    }
    void product.voice.hasApiKey().then(setAvailable).catch(() => setAvailable(false));
  }, [enabled]);

  const uniqueId = useId();
  const key = ownerKey ?? uniqueId;
  const transcriptRef = useRef(onTranscript);
  transcriptRef.current = onTranscript;
  useEffect(() => {
    let entry = captures.get(key);
    if (!entry) {
      const listeners = new Set<() => void>();
      const next: CaptureEntry = { state: 'idle', stream: null, listeners, session: null!, transcript: onTranscript };
      const publish = () => {
        for (const listener of listeners) listener();
        if (listeners.size === 0 && next.state === 'idle' && captures.get(key) === next) captures.delete(key);
      };
      next.session = createVoiceCapture(
        {
          ensureMicAccess: () => product.voice.ensureMicAccess(),
          transcribe: (audio, mimeType) => product.voice.transcribe(audio, mimeType),
          getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints)
        },
        {
          onState: state => { next.state = state; publish(); },
          onStream: stream => { next.stream = stream; publish(); },
          onTranscript: text => next.transcript(text),
          onError: message => pushToast(message, 'error')
        }
      );
      entry = next;
      captures.set(key, entry);
    }
    const current = entry;
    const update = () => { setState(current.state); setStream(current.stream); };
    current.listeners.add(update);
    update();
    sessionRef.current = current.session;
    return () => {
      current.listeners.delete(update);
      if (current.listeners.size === 0) current.session.dispose({ preserveTranscription: true });
      if (current.listeners.size === 0 && current.state === 'idle') captures.delete(key);
      sessionRef.current = null;
    };
  }, [key, pushToast]);

  const start = useCallback(async () => {
    const blocked = voiceStartBlockReason(isSupported, available);
    if (blocked) {
      showError(blocked);
      return;
    }
    const entry = captures.get(key);
    // Bound retained clips without evicting another thread's pending audio.
    if (entry?.state === 'idle' && [...captures.values()].filter(row => row.state !== 'idle').length >= 3) {
      pushToast('Finish or cancel a pending recording before starting another.', 'error');
      return;
    }
    if (entry) entry.transcript = transcriptRef.current;
    await sessionRef.current?.start();
  }, [available, isSupported, showError, key, pushToast]);

  const stop = useCallback((onTranscript?: (text: string) => void | Promise<void>) => {
    const entry = captures.get(key);
    if (entry && onTranscript) entry.transcript = onTranscript;
    sessionRef.current?.stop();
  }, [key]);

  const cancel = useCallback(() => {
    sessionRef.current?.cancel();
  }, []);

  return {
    state,
    isSupported,
    available,
    canStart: isSupported && available && state !== 'recording' && state !== 'transcribing',
    stream,
    start,
    stop,
    cancel,
    retry: () => sessionRef.current?.retry(),
    canRetry: sessionRef.current?.canRetry() ?? false
  };
}
