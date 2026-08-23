import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createRecordingFile,
  fileToBase64,
  MIN_RECORDING_DURATION_MS,
  normalizeTranscript,
  resolvePreferredAudioMimeType,
  resolveRecordingErrorMessage,
  voiceStartBlockReason
} from './voice-helpers.js';
import { VoiceRecordingBar } from './VoiceRecordingBar.js';

describe('voice helpers', () => {
  it('normalizes transcript whitespace and maps mic errors', () => {
    expect(normalizeTranscript('  hello   world\n')).toBe('hello world');
    expect(MIN_RECORDING_DURATION_MS).toBe(1000);
    expect(resolveRecordingErrorMessage(new DOMException('denied', 'NotAllowedError')))
      .toBe('Microphone permission denied');
    expect(resolveRecordingErrorMessage(new DOMException('sec', 'SecurityError')))
      .toBe('Microphone permission denied');
    expect(resolveRecordingErrorMessage(new DOMException('gone', 'NotFoundError'), true))
      .toBe('Selected microphone was not found');
    expect(resolveRecordingErrorMessage(new DOMException('gone', 'DevicesNotFoundError')))
      .toBe('No microphone was found');
    expect(resolveRecordingErrorMessage(new DOMException('busy', 'TrackStartError')))
      .toBe('Microphone is already in use');
    expect(resolveRecordingErrorMessage(new DOMException('busy', 'NotReadableError')))
      .toBe('Microphone is already in use');
    expect(resolveRecordingErrorMessage(new DOMException('abort', 'AbortError')))
      .toBe('Voice capture was aborted');
    expect(resolveRecordingErrorMessage(new DOMException('other', 'OtherError')))
      .toBe('Failed to start voice recording');
    expect(resolveRecordingErrorMessage(new Error('  boom  '))).toBe('boom');
    expect(resolveRecordingErrorMessage(null)).toBe('Voice input failed');
    expect(voiceStartBlockReason(false, true)).toBe('Voice input is not supported in this browser');
    expect(voiceStartBlockReason(true, false)).toBe('Host daemon is not connected');
    expect(voiceStartBlockReason(true, true)).toBeNull();
  });

  it('names the recording file from the mime type', () => {
    expect(createRecordingFile(new Blob(['a']), 'audio/webm').name).toBe('recording.webm');
    expect(createRecordingFile(new Blob(['a']), 'audio/mp4').name).toBe('recording.mp4');
    expect(createRecordingFile(new Blob(['a']), 'audio/ogg').name).toBe('recording.ogg');
  });

  it('encodes a file as base64', async () => {
    const file = createRecordingFile(new Blob(['hi']), 'audio/webm');
    await expect(fileToBase64(file)).resolves.toBe(btoa('hi'));
  });

  it('picks a supported audio mime type', () => {
    expect(resolvePreferredAudioMimeType()).toBeNull();
    (globalThis as { MediaRecorder?: { isTypeSupported: (type: string) => boolean } }).MediaRecorder = {
      isTypeSupported: (type) => type === 'audio/mp4'
    };
    expect(resolvePreferredAudioMimeType()).toBe('audio/mp4');
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  });
});

describe('voice recording bar', () => {
  it('renders cancel and confirm while recording', () => {
    const html = renderToStaticMarkup(
      <VoiceRecordingBar
        state="recording"
        stream={null}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(html).toContain('thread-voice-bar');
    expect(html).toContain('Cancel recording');
    expect(html).toContain('Stop and transcribe recording');
    expect(html).toContain('Recording');
  });

  it('disables confirm and announces transcription', () => {
    const html = renderToStaticMarkup(
      <VoiceRecordingBar
        state="transcribing"
        stream={null}
        onConfirm={() => undefined}
        onCancel={() => undefined}
      />
    );
    expect(html).toContain('Cancel transcription');
    expect(html).toContain('Transcribing voice input');
    expect(html).toContain('disabled');
  });
});
