import type { VoiceTranscribeResult } from '../../shared/types.js';

export interface VoiceTranscribeRequest {
  audio: Buffer;
  mimeType: string;
  model?: string;
  language?: string;
}

export interface VoiceProvider {
  readonly id: string;
  transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult>;
}

export type VoiceProviderMap = Map<string, VoiceProvider>;
