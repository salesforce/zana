import { useState, useRef, useEffect } from 'react';
import { Mic, Loader2 } from 'lucide-react';
import { useUi } from '../store';
import type { AutoGrowTextareaHandle } from './ui/CommandComposer';

interface Props {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  textareaRef?: React.RefObject<AutoGrowTextareaHandle>;
  /** Render just the mic glyph (no text label) — for tight composer toolbars. */
  iconOnly?: boolean;
}

/** Number of bars in the live "voice vibration" meter shown while recording. */
const WAVE_BARS = 5;

/** Pick the first MediaRecorder container the browser actually supports.
 *  Chromium can't produce WAV, so never fall back to it — an undefined
 *  mimeType lets the browser choose, which always yields a real container. */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return undefined;
}

/** Base64-encode bytes in chunks — a single String.fromCharCode(...bytes)
 *  spread (or a per-byte reduce) blows the call stack / hangs on long clips. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function VoiceInputButton({ value, onChange, className, textareaRef, iconOnly }: Props) {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const pushToast = useUi((s) => s.pushToast);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Live-waveform plumbing. We drive the bar heights directly on the DOM nodes
  // from the rAF loop so recording doesn't re-render the tree ~60×/second.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const barRefs = useRef<Array<HTMLSpanElement | null>>([]);

  useEffect(() => {
    window.cc.voice.hasApiKey().then(setHasKey).catch(() => setHasKey(false));
  }, []);

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const stopMeter = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    analyserRef.current?.disconnect();
    analyserRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  };

  const startMeter = (stream: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const buf = new Uint8Array(analyser.frequencyBinCount);
      // Slice the low-frequency bins (where speech energy lives) into WAVE_BARS
      // bands, then map each band's average level to a bar height.
      const band = Math.max(1, Math.floor(buf.length / 2 / WAVE_BARS));

      const tick = () => {
        analyser.getByteFrequencyData(buf);
        for (let b = 0; b < WAVE_BARS; b += 1) {
          let sum = 0;
          for (let i = 0; i < band; i += 1) sum += buf[b * band + i] ?? 0;
          const level = sum / band / 255; // 0..1
          const el = barRefs.current[b];
          if (el) el.style.transform = `scaleY(${0.15 + level * 0.85})`;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // Visualization is decorative — a failure here must never break capture.
    }
  };

  const stopRecording = () => {
    stopMeter();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    recorderRef.current = null;
    chunksRef.current = [];
  };

  const startRecording = async () => {
    if (!hasKey) {
      pushToast('No OpenAI API key configured. Add one in Settings.', 'error');
      return;
    }

    // On macOS, getUserMedia is silently denied unless the OS-level mic
    // permission is granted first — request/verify it before we open the mic.
    const micOk = await window.cc.voice.ensureMicAccess().catch(() => true);
    if (!micOk) {
      pushToast(
        'Microphone access is off. Enable it for the app in System Settings › Privacy › Microphone.',
        'error'
      );
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = (err as Error).name;
      pushToast(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Microphone access denied. Enable it for the app in System Settings › Privacy › Microphone.'
          : `Could not open the microphone: ${(err as Error).message}`,
        'error'
      );
      return;
    }

    try {
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      // The browser may have picked its own container when we passed none.
      const actualType = recorder.mimeType || mimeType || 'audio/webm';
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        setRecording(false);
        stopMeter();
        setTranscribing(true);

        try {
          const blob = new Blob(chunksRef.current, { type: actualType });
          const arrayBuffer = await blob.arrayBuffer();
          const base64 = bytesToBase64(new Uint8Array(arrayBuffer));

          const result = await window.cc.voice.transcribe(base64, actualType);

          if (!result.ok || !result.text.trim()) {
            pushToast(result.error || 'No speech detected', 'error');
            return;
          }

      const el = textareaRef?.current?.element();
          const start = el?.selectionStart ?? value.length;
          const end = el?.selectionEnd ?? value.length;
          const before = value.slice(0, start);
          const after = value.slice(end);
          const lead = before && !/\s$/.test(before) ? ' ' : '';
          const trail = after && !/^\s/.test(after) ? ' ' : '';
          const transcript = result.text.trim();
          const caret = (before + lead + transcript).length;

          onChange(before + lead + transcript + trail + after);

          requestAnimationFrame(() => {
            el?.focus();
            el?.setSelectionRange(caret, caret);
          });
        } catch (err) {
          pushToast(`Transcription failed: ${(err as Error).message}`, 'error');
        } finally {
          setTranscribing(false);
          stopRecording();
        }
      };

      recorder.start();
      setRecording(true);
      startMeter(stream);
    } catch (err) {
      pushToast(`Could not start recording: ${(err as Error).message}`, 'error');
      stopRecording();
    }
  };

  const handleClick = () => {
    if (recording) {
      if (recorderRef.current) recorderRef.current.stop();
    } else {
      void startRecording();
    }
  };

  const icon = transcribing ? (
    <Loader2 size={13} className="voice-input-spin" aria-hidden="true" />
  ) : recording ? (
    <span className="voice-wave" aria-hidden="true">
      {Array.from({ length: WAVE_BARS }, (_, i) => (
        <span
          key={i}
          className="voice-wave-bar"
          ref={(el) => {
            barRefs.current[i] = el;
          }}
        />
      ))}
    </span>
  ) : (
    <Mic size={13} aria-hidden="true" />
  );

  const label = transcribing ? 'Transcribing…' : recording ? 'Stop recording' : 'Dictate';

  const title = !hasKey
    ? 'No API key configured (add one in Settings)'
    : transcribing
      ? 'Transcribing your voice…'
      : recording
        ? 'Click to stop recording'
        : 'Click to start dictation';

  return (
    <button
      type="button"
      className={`voice-input-btn ${iconOnly ? 'voice-input-btn--icon' : ''} ${recording ? 'is-recording' : ''} ${className ?? ''}`}
      onClick={handleClick}
      disabled={!hasKey || transcribing}
      title={title}
      aria-label={title}
    >
      {icon}
      {!iconOnly && label}
    </button>
  );
}
