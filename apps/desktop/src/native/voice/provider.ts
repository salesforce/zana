import type { VoiceTranscribeResult } from '@zana-ai/zcc-domain/product';

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
