import { useEffect, useRef } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { startWaveform } from './waveform.js';

export function VoiceRecordingBar({
  state,
  stream,
  onConfirm,
  onCancel
}: {
  state: 'recording' | 'transcribing';
  stream: MediaStream | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isTranscribing = state === 'transcribing';
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    return startWaveform(canvas, stream, !isTranscribing);
  }, [stream, isTranscribing]);

  return (
    <div className="thread-voice-bar" data-testid="thread-voice-bar">
      <button
        type="button"
        className="thread-voice-bar-btn"
        aria-label={isTranscribing ? 'Cancel transcription' : 'Cancel recording'}
        onClick={onCancel}
      >
        <X size={14} />
      </button>
      <div className={`thread-voice-bar-wave${isTranscribing ? ' is-transcribing' : ''}`}>
        <canvas ref={canvasRef} aria-hidden className="thread-voice-wave" />
        <span className="sr-only">{isTranscribing ? 'Transcribing' : 'Recording'}</span>
      </div>
      <button
        type="button"
        className="thread-voice-bar-btn is-confirm"
        aria-label={isTranscribing ? 'Transcribing voice input' : 'Stop and transcribe recording'}
        disabled={isTranscribing}
        onClick={onConfirm}
      >
        {isTranscribing ? <Loader2 size={14} className="voice-input-spin" /> : <Check size={14} />}
      </button>
    </div>
  );
}
