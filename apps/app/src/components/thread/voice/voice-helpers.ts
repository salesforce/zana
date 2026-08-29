export type VoiceInputState = 'idle' | 'recording' | 'transcribing' | 'error';

export const MIN_RECORDING_DURATION_MS = 1_000;
const CHUNK_TIMESLICE_MS = 250;

export function normalizeTranscript(rawText: string): string {
  return rawText.replace(/\s+/g, ' ').trim();
}

export function resolveRecordingErrorMessage(error: unknown, hasPreferredAudioInput = false): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotAllowedError':
      case 'SecurityError':
        return 'Microphone permission denied';
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return hasPreferredAudioInput ? 'Selected microphone was not found' : 'No microphone was found';
      case 'NotReadableError':
      case 'TrackStartError':
        return 'Microphone is already in use';
      case 'AbortError':
        return 'Voice capture was aborted';
      default:
        return 'Failed to start voice recording';
    }
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.replace(/\s+/g, ' ').trim();
  }
  return 'Voice input failed';
}

export function voiceStartBlockReason(isSupported: boolean, available: boolean): string | null {
  if (!isSupported) return 'Voice input is not supported in this browser';
  if (!available) return 'Host daemon is not connected';
  return null;
}

export function resolvePreferredAudioMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of ['audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

export function createRecordingFile(audioBlob: Blob, mimeType: string): File {
  const extension = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  return new File([audioBlob], `recording.${extension}`, { type: mimeType });
}

export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export { CHUNK_TIMESLICE_MS };
