import type { VoiceProvider, VoiceProviderMap, VoiceTranscribeRequest } from './provider.js';
import type { VoiceTranscribeResult } from '@zana-ai/zcc-domain/product';

const DEFAULT_PROVIDER = 'openai';

export class VoiceService {
  constructor(private readonly providers: VoiceProviderMap) {}

  setProvider(provider: VoiceProvider): void {
    this.providers.set(provider.id, provider);
  }

  async transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
    const provider = this.providers.get(DEFAULT_PROVIDER);
    if (!provider) {
      return { ok: false, text: '', error: `No voice provider registered for '${DEFAULT_PROVIDER}'`, ms: 0 };
    }
    return provider.transcribe(req);
  }
}
