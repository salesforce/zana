import type { VoiceProvider, VoiceTranscribeRequest } from './provider.js';
import type { VoiceTranscribeResult } from '@zana-ai/zcc-domain/product';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export class OpenAiVoiceProvider implements VoiceProvider {
  readonly id = 'openai';

  constructor(private readonly getApiKey: () => string | null | Promise<string | null>) {}

  async transcribe(req: VoiceTranscribeRequest): Promise<VoiceTranscribeResult> {
    const startMs = Date.now();

    const apiKey = await this.getApiKey();
    if (!apiKey) {
      return { ok: false, text: '', error: 'No OpenAI API key configured', ms: Date.now() - startMs };
    }

    if (req.audio.byteLength > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        text: '',
        error: `Audio too large (${(req.audio.byteLength / (1024 * 1024)).toFixed(1)} MB, max 25 MB)`,
        ms: Date.now() - startMs
      };
    }

    try {
      const boundary = `----VoiceBoundary${Date.now()}`;
      const parts: Buffer[] = [];

      const model = req.model || 'whisper-1';
      parts.push(Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${model}\r\n`
      ));

      if (req.language) {
        parts.push(Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n${req.language}\r\n`
        ));
      }

      const ext = req.mimeType.includes('webm') ? 'webm' : 'wav';
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\n` +
          `Content-Type: ${req.mimeType}\r\n\r\n`
        ),
        req.audio,
        Buffer.from(`\r\n--${boundary}--\r\n`)
      );

      const body = Buffer.concat(parts);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const res = await fetch(OPENAI_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return { ok: false, text: '', error: `OpenAI error ${res.status}: ${errorText.slice(0, 200)}`, ms: Date.now() - startMs };
      }

      const data = (await res.json()) as { text?: string };
      return { ok: true, text: data.text?.trim() ?? '', ms: Date.now() - startMs };
    } catch (err) {
      const isTimeout = (err as Error).name === 'AbortError';
      return {
        ok: false,
        text: '',
        error: isTimeout ? 'Request timed out' : `Network error: ${(err as Error).message}`,
        ms: Date.now() - startMs
      };
    }
  }
}
