import type { LlmRunResult } from '../../shared/types.js';
import type { LlmProvider, LlmRunRequest } from './provider.js';
import { resolveModelAlias } from './model-aliases.js';

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_CHARS = 2_000;
const DEFAULT_MODEL = 'gemini-2.0-flash';

interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/**
 * Google Gemini `generateContent` transport for the LLM micro-call seam. Twin of
 * {@link import('./openai-provider.js').OpenAiProvider} against a different HTTP
 * shape: Gemini takes the API key as a query param, carries the system prompt in
 * a dedicated `system_instruction` field, and nests the reply under
 * `candidates[].content.parts[].text`.
 *
 * Same "never throw" contract: no key, HTTP error, network error, timeout, and
 * abort all resolve to an `ok:false` result. A Claude tier alias (haiku/sonnet)
 * in `req.model` is mapped to a concrete Gemini id via {@link resolveModelAlias}.
 */
export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini' as const;

  constructor(private readonly getApiKey: () => string | null) {}

  /** Usable only when a Gemini API key is stored (else every run() is ok:false). */
  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  async run(req: LlmRunRequest): Promise<LlmRunResult> {
    const startedAt = Date.now();
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputChars = req.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS;
    const model = resolveModelAlias(this.id, req.model) ?? DEFAULT_MODEL;

    const fail = (error: string): LlmRunResult => ({
      ok: false,
      text: '',
      error,
      provider: this.id,
      model,
      ms: Date.now() - startedAt
    });

    const apiKey = this.getApiKey();
    if (!apiKey) return fail('no Gemini API key configured');

    if (req.signal?.aborted) return fail('aborted');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = (): void => controller.abort();
    req.signal?.addEventListener('abort', onAbort);

    try {
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: req.user }] }]
      };
      if (req.system.trim()) {
        body.system_instruction = { parts: [{ text: req.system }] };
      }

      // Key rides in the header (`x-goog-api-key`), never the URL, so it can't
      // leak into request logs / error text built from the endpoint.
      const url = `${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        return fail(`Gemini error ${res.status}: ${errorText.slice(0, 200)}`);
      }

      const data = (await res.json()) as GenerateContentResponse;
      const text = (data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '')
        .trim()
        .slice(0, maxOutputChars);
      const usage =
        data.usageMetadata?.promptTokenCount !== undefined ||
        data.usageMetadata?.candidatesTokenCount !== undefined
          ? {
              inputTokens: data.usageMetadata?.promptTokenCount,
              outputTokens: data.usageMetadata?.candidatesTokenCount
            }
          : undefined;
      return {
        ok: true,
        text,
        provider: this.id,
        model,
        ms: Date.now() - startedAt,
        usage
      };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return fail(req.signal?.aborted ? 'aborted' : `timed out after ${timeoutMs}ms`);
      }
      return fail(err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}
