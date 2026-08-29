import { useCallback, useEffect, useRef, useState } from 'react';
import { product } from '../../../lib/product-client.js';
import { useUi } from '../../../store.js';
import { createVoiceCapture, type VoiceCaptureSession } from './voice-session.js';
import { voiceStartBlockReason, type VoiceInputState } from './voice-helpers.js';

export interface UseVoiceInputOptions {
  onTranscript: (text: string) => void;
  enabled?: boolean;
}

export function useVoiceInput({ onTranscript, enabled = true }: UseVoiceInputOptions) {
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

  useEffect(() => {
    const session = createVoiceCapture(
      {
        ensureMicAccess: () => product.voice.ensureMicAccess(),
        transcribe: (audio, mimeType) => product.voice.transcribe(audio, mimeType),
        getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints)
      },
      {
        onState: setState,
        onStream: setStream,
        onTranscript,
        onError: showError
      }
    );
    sessionRef.current = session;
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
  }, [onTranscript, showError]);

  const start = useCallback(async () => {
    const blocked = voiceStartBlockReason(isSupported, available);
    if (blocked) {
      showError(blocked);
      return;
    }
    await sessionRef.current?.start();
  }, [available, isSupported, showError]);

  const stop = useCallback(() => {
    sessionRef.current?.stop();
  }, []);

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
    cancel
  };
}
